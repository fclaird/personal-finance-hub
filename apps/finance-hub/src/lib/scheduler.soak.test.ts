import assert from "node:assert/strict";
import http from "node:http";
import { describe, it } from "node:test";

import { awaitGlobalRefresh } from "@/lib/schwab/ensureOptionGreeks";
import { QUOTE_CACHE_MAX, primeQuoteCacheForTests } from "@/lib/schwab/quotesFetch";

import { buildHealthReport, type HealthSchedulerSnapshot } from "./healthReport";
import { resetSchedulerForTests, schedulerDebugState, startSchedulerOnce, type SchedulerTimers } from "./scheduler";

type Task = { at: number; kind: "interval" | "timeout"; every: number; fn: () => void; id: number };

function createFakeTimers(): SchedulerTimers & { advance: (ms: number) => void } {
  let now = 0;
  let nextId = 1;
  const tasks: Task[] = [];

  function arm(kind: Task["kind"], fn: () => void, ms: number) {
    const id = nextId++;
    tasks.push({ at: now + ms, kind, every: ms, fn, id });
    return id as unknown as NodeJS.Timeout;
  }

  function clear(id: NodeJS.Timeout) {
    const n = id as unknown as number;
    const index = tasks.findIndex((task) => task.id === n);
    if (index >= 0) tasks.splice(index, 1);
  }

  return {
    setTimeout: (fn, ms) => arm("timeout", fn, ms),
    setInterval: (fn, ms) => arm("interval", fn, ms),
    clearTimeout: clear,
    clearInterval: clear,
    advance(ms: number) {
      const target = now + ms;
      for (;;) {
        const due = tasks
          .filter((task) => task.at <= target)
          .sort((a, b) => a.at - b.at || a.id - b.id);
        const next = due[0];
        if (!next) break;
        now = next.at;
        if (next.kind === "interval") next.at = now + next.every;
        else {
          const index = tasks.findIndex((task) => task.id === next.id);
          if (index >= 0) tasks.splice(index, 1);
        }
        next.fn();
      }
      now = target;
    },
  };
}

function get(port: number, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: "127.0.0.1", port, path, timeout: 2_000 }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () =>
        resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }),
      );
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`timeout ${path}`));
    });
  });
}

describe("scheduler soak", () => {
  it("keeps a single tick in flight across a simulated day of timer fires", () => {
    resetSchedulerForTests();
    const timers = createFakeTimers();
    try {
      startSchedulerOnce({
        timers,
        intervalMs: 60_000,
        initialDelayMs: 60_000,
        tick: () => new Promise(() => {}),
      });
      timers.advance(24 * 60 * 60 * 1000);
      const state = schedulerDebugState();
      assert.equal(state.ticksStarted, 1);
      assert.equal(state.inFlight, true);
      assert.ok(state.overlapSkips >= 24 * 60);
    } finally {
      resetSchedulerForTests();
    }
  });

  it("answers health and positions while a refresh never settles", async () => {
    resetSchedulerForTests();
    const timers = createFakeTimers();
    const hung = new Promise<never>(() => {});
    const previous = globalThis.__fhSchwabRefreshRunning;
    globalThis.__fhSchwabRefreshRunning = hung as typeof globalThis.__fhSchwabRefreshRunning;
    startSchedulerOnce({
      timers,
      intervalMs: 60_000,
      initialDelayMs: 60_000,
      tick: () => hung,
    });
    timers.advance(6 * 60 * 60 * 1000);

    const server = http.createServer((req, res) => {
      const path = req.url ?? "/";
      if (path.startsWith("/api/health")) {
        const state = schedulerDebugState();
        const body = JSON.stringify(
          buildHealthReport({
            scheduler: {
              started: state.started,
              inFlight: state.inFlight,
              overlapSkips: state.overlapSkips,
              ticksStarted: state.ticksStarted,
              lastTickAt: state.lastTickAt,
              lastSlowRunAt: state.lastSlowRunAt,
              lastAccountValueRunAt: state.lastAccountValueRunAt,
            },
            latestMigration: null,
            walBytes: null,
          }),
        );
        res.writeHead(200, { "content-type": "application/json" });
        res.end(body);
        return;
      }
      if (path.startsWith("/api/positions")) {
        void awaitGlobalRefresh(50).then((status) => {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true, refresh: status, positions: [] }));
        });
        return;
      }
      res.writeHead(404);
      res.end();
    });

    const port = await new Promise<number>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        resolve(typeof addr === "object" && addr ? addr.port : 0);
      });
    });

    try {
      const started = Date.now();
      const results = await Promise.all([
        ...Array.from({ length: 40 }, () => get(port, "/api/health")),
        ...Array.from({ length: 40 }, () => get(port, "/api/positions")),
      ]);
      assert.ok(Date.now() - started < 2_000);
      assert.equal(results.every((result) => result.status === 200), true);
      const health = JSON.parse(results[0]!.body) as { ok: boolean; scheduler: HealthSchedulerSnapshot; handles?: unknown };
      assert.equal(health.ok, true);
      assert.equal(health.scheduler.inFlight, true);
      assert.ok(health.scheduler.overlapSkips >= 6 * 60);
      assert.equal(health.scheduler.ticksStarted, 1);
      const positions = JSON.parse(results[40]!.body) as { ok: boolean; refresh: string };
      assert.equal(positions.ok, true);
      assert.equal(positions.refresh, "timeout");
    } finally {
      if (previous) globalThis.__fhSchwabRefreshRunning = previous;
      else delete globalThis.__fhSchwabRefreshRunning;
      resetSchedulerForTests();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("caps the in-memory quote cache", () => {
    assert.equal(primeQuoteCacheForTests(20_000), QUOTE_CACHE_MAX);
    primeQuoteCacheForTests(0);
  });
});

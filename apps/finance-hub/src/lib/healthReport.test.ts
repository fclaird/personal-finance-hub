import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildHealthReport, countOpenHandles, type HealthSchedulerSnapshot } from "./healthReport";

const scheduler: HealthSchedulerSnapshot = {
  started: true,
  inFlight: true,
  overlapSkips: 42,
  ticksStarted: 1,
  lastTickAt: 10,
  lastSlowRunAt: 20,
  lastAccountValueRunAt: 30,
};

describe("buildHealthReport", () => {
  it("reports uptime, heap, and open handles without a database path", () => {
    const report = buildHealthReport({
      vitals: {
        pid: 99,
        uptimeSec: 86_400,
        memory: { rss: 10, heapUsed: 4, heapTotal: 8, external: 1 },
        handles: { active: 7, requests: 2 },
      },
      scheduler,
      latestMigration: { name: "0001_init", applied_at: "2026-01-01" },
      walBytes: 4096,
      dbPath: null,
    });
    assert.equal(report.ok, true);
    assert.equal(report.pid, 99);
    assert.equal(report.uptimeSec, 86_400);
    assert.equal(report.memory.heapUsed, 4);
    assert.equal(report.handles.active, 7);
    assert.equal(report.handles.requests, 2);
    assert.equal(report.scheduler.overlapSkips, 42);
    assert.equal(report.scheduler.inFlight, true);
    assert.equal(report.walBytes, 4096);
    assert.equal("dbPath" in report, false);
  });

  it("includes the db path only when one is passed", () => {
    const report = buildHealthReport({
      vitals: {
        pid: 1,
        uptimeSec: 1,
        memory: { rss: 1, heapUsed: 1, heapTotal: 1, external: 0 },
        handles: { active: 0, requests: 0 },
      },
      scheduler,
      latestMigration: null,
      dbPath: "/tmp/finance-hub.sqlite",
    });
    assert.equal(report.dbPath, "/tmp/finance-hub.sqlite");
  });

  it("counts live process handles", () => {
    const handles = countOpenHandles();
    assert.equal(typeof handles.active, "number");
    assert.ok(handles.active >= 0);
    assert.ok(handles.requests >= 0);
  });
});

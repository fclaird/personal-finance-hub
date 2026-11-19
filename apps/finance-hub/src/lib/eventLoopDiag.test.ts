import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import Database from "better-sqlite3";

import { applyRuntimePragmas } from "@/lib/dbPragmas";
import {
  checkpointWalOffThread,
  createSlicePacer,
  formatInflight,
  inflightJobs,
  parseYahooChartOffThread,
  runTracked,
  shouldLogEventLoopLag,
  stopEventLoopMonitorForTests,
  yieldEventLoop,
} from "@/lib/eventLoopDiag";

describe("event loop diagnostics", () => {
  it("names an in-flight job with its start time and clears it when the job ends", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fh-loop-"));
    const logPath = path.join(dir, "bridge.log");
    const previous = process.env.FINANCE_HUB_BRIDGE_LOG;
    process.env.FINANCE_HUB_BRIDGE_LOG = logPath;
    try {
      let seen = "";
      await runTracked("wal_checkpoint", async () => {
        const jobs = inflightJobs();
        assert.equal(jobs.length, 1);
        assert.equal(jobs[0]?.name, "wal_checkpoint");
        seen = formatInflight(jobs, jobs[0]!.startedAt);
        await yieldEventLoop();
      });
      assert.match(seen, /^wal_checkpoint start=.+ age_ms=0$/);
      assert.equal(inflightJobs().length, 0);
      const text = fs.readFileSync(logPath, "utf8");
      assert.match(text, /job_start name=wal_checkpoint start=/);
      assert.match(text, /job_end name=wal_checkpoint start=.+ end=.+ ms=\d+/);
      assert.equal(shouldLogEventLoopLag(500), false);
      assert.equal(shouldLogEventLoopLag(501), true);
    } finally {
      if (previous === undefined) delete process.env.FINANCE_HUB_BRIDGE_LOG;
      else process.env.FINANCE_HUB_BRIDGE_LOG = previous;
      stopEventLoopMonitorForTests();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("lets a timer run while a sync loop yields", async () => {
    let ran = false;
    setImmediate(() => {
      ran = true;
    });
    await yieldEventLoop();
    assert.equal(ran, true);
    const pace = createSlicePacer(0);
    ran = false;
    setImmediate(() => {
      ran = true;
    });
    await pace();
    assert.equal(ran, true);
  });

  it("parses a Yahoo chart off the request thread and drops the raw document", async () => {
    const body = JSON.stringify({
      chart: {
        result: [
          {
            meta: { symbol: "SPY", regularMarketPrice: 500 },
            timestamp: [1, 2],
            indicators: { quote: [{ close: [10, 11], open: [9, 10] }] },
            events: { dividends: { "1": { amount: 1 } } },
          },
        ],
      },
    });
    const slim = await parseYahooChartOffThread(Buffer.from(body));
    assert.equal(slim?.meta?.symbol, "SPY");
    assert.deepEqual(slim?.timestamp, [1, 2]);
    assert.deepEqual(slim?.close, [10, 11]);
    assert.equal((slim?.events as { dividends?: unknown }).dividends != null, true);
  });

  it("checkpoints the WAL off the request thread", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fh-ck-"));
    const dbPath = path.join(dir, "hub.sqlite");
    const db = new Database(dbPath);
    let ticks = 0;
    const timer = setInterval(() => {
      ticks += 1;
    }, 5);
    try {
      applyRuntimePragmas(db);
      db.exec("CREATE TABLE ticks (id INTEGER PRIMARY KEY, body TEXT)");
      const insert = db.prepare("INSERT INTO ticks (body) VALUES (?)");
      const tx = db.transaction(() => {
        for (let i = 0; i < 200; i++) insert.run("x".repeat(200));
      });
      tx();
      const pending = checkpointWalOffThread(dbPath);
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.ok(ticks > 0, "checkpoint held the event loop");
      const result = await pending;
      assert.equal(typeof result.checkpointed, "number");
      assert.ok(result.checkpointed >= 0);
    } finally {
      clearInterval(timer);
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

import assert from "node:assert/strict";
import test from "node:test";

import Database from "better-sqlite3";

import { bucketAccountValueAsOf, shouldSkipAccountValueWrite } from "./accountValuePoints";
import { pruneHoldingSnapshots, pruneSchwabRefreshRuns } from "./pruneHoldingSnapshots";

test("bucketAccountValueAsOf rounds to minute", () => {
  const asOf = bucketAccountValueAsOf(Date.parse("2026-06-11T15:04:55.748Z"));
  assert.equal(asOf, "2026-06-11T15:04:00.000Z");
});

test("shouldSkipAccountValueWrite skips duplicate minute bucket with tiny delta", () => {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE account_value_points (
      account_id TEXT NOT NULL,
      as_of TEXT NOT NULL,
      equity_value REAL NOT NULL,
      cash_value REAL,
      prior_equity_value REAL,
      source TEXT,
      PRIMARY KEY (account_id, as_of)
    );
  `);
  const asOf = bucketAccountValueAsOf();
  db.prepare(
    `INSERT INTO account_value_points (account_id, as_of, equity_value) VALUES ('schwab_a', ?, 1000)`,
  ).run(asOf);
  assert.equal(shouldSkipAccountValueWrite(db, "schwab_a", asOf, 1000.1), true);
  assert.equal(shouldSkipAccountValueWrite(db, "schwab_a", asOf, 1005), false);
  db.close();
});

test("pruneHoldingSnapshots keeps newest N per account", () => {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE holding_snapshots (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, as_of TEXT NOT NULL);
    CREATE TABLE positions (id TEXT PRIMARY KEY, snapshot_id TEXT NOT NULL REFERENCES holding_snapshots(id) ON DELETE CASCADE);
  `);
  for (let i = 0; i < 10; i++) {
    const id = `snap_${i}`;
    db.prepare(`INSERT INTO holding_snapshots (id, account_id, as_of) VALUES (?, 'a1', ?)`).run(
      id,
      `2026-01-${String(i + 1).padStart(2, "0")}T12:00:00Z`,
    );
    db.prepare(`INSERT INTO positions (id, snapshot_id) VALUES (?, ?)`).run(`pos_${i}`, id);
  }
  const pruned = pruneHoldingSnapshots(db, 3);
  assert.equal(pruned, 7);
  const remaining = db.prepare(`SELECT COUNT(*) AS c FROM holding_snapshots WHERE account_id = 'a1'`).get() as {
    c: number;
  };
  assert.equal(remaining.c, 3);
  db.close();
});

test("pruneSchwabRefreshRuns deletes old finished rows", () => {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE schwab_refresh_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mode TEXT,
      started_at TEXT,
      finished_at TEXT,
      ok INTEGER
    );
  `);
  db.prepare(`INSERT INTO schwab_refresh_runs (mode, started_at, finished_at, ok) VALUES ('rth', '2020-01-01', '2020-01-01', 1)`).run();
  db.prepare(`INSERT INTO schwab_refresh_runs (mode, started_at, finished_at, ok) VALUES ('rth', '2099-01-01', '2099-01-01', 1)`).run();
  const pruned = pruneSchwabRefreshRuns(db, 30);
  assert.equal(pruned, 1);
  const left = db.prepare(`SELECT COUNT(*) AS c FROM schwab_refresh_runs`).get() as { c: number };
  assert.equal(left.c, 1);
  db.close();
});

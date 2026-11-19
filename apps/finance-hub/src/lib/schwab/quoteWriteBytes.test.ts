import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import Database from "better-sqlite3";

import { applyRuntimePragmas } from "@/lib/dbPragmas";
import { writeQuoteCloses } from "@/lib/schwab/schwabQuotesPersist";

function walBytes(dbPath: string): number {
  try {
    return fs.statSync(`${dbPath}-wal`).size;
  } catch {
    return 0;
  }
}

describe("quote close writes", () => {
  it("does not grow the WAL when the same closes are written again", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fh-quote-wal-"));
    const dbPath = path.join(dir, "hub.sqlite");
    const db = new Database(dbPath);
    try {
      applyRuntimePragmas(db);
      db.exec(`
        CREATE TABLE price_points (
          provider TEXT NOT NULL,
          symbol TEXT NOT NULL,
          date TEXT NOT NULL,
          close REAL NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (provider, symbol, date)
        );
      `);
      const rows = Array.from({ length: 200 }, (_, i) => ({
        symbol: `S${i}`,
        date: "2026-11-16",
        close: 100 + i / 100,
      }));
      const first = writeQuoteCloses(db, rows);
      assert.equal(first.written, 200);
      assert.equal(first.unchanged, 0);
      db.pragma("wal_checkpoint(TRUNCATE)");
      const afterCheckpoint = walBytes(dbPath);

      const second = writeQuoteCloses(db, rows);
      assert.equal(second.written, 0);
      assert.equal(second.unchanged, 200);
      const unchangedGrowth = walBytes(dbPath) - afterCheckpoint;

      const moved = rows.map((row) => ({ ...row, close: row.close + 1 }));
      const third = writeQuoteCloses(db, moved);
      assert.equal(third.written, 200);
      const movedGrowth = walBytes(dbPath) - afterCheckpoint;

      assert.ok(unchangedGrowth < 4096, `unchanged pass grew WAL by ${unchangedGrowth} bytes`);
      assert.ok(movedGrowth > unchangedGrowth, `moved growth ${movedGrowth} vs unchanged ${unchangedGrowth}`);
    } finally {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

import fs from "node:fs";
import path from "node:path";

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";

import {
  allocationDailyCloseTradeDate,
  shouldWriteAllocationDailyClose,
} from "@/lib/analytics/allocationNyDate";
import { recordAllocationDailyClose } from "@/lib/analytics/recordAllocationDailyClose";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  const schemaPath = path.join(process.cwd(), "src", "db", "schema.sql");
  db.exec(fs.readFileSync(schemaPath, "utf-8"));
  db.prepare(
    `INSERT INTO institution_connections (id, type, display_name, status) VALUES ('conn', 'schwab', 'Schwab', 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO accounts (id, connection_id, name, type, account_bucket) VALUES ('schwab_alloc', 'conn', 'Brokerage', 'brokerage', 'brokerage')`,
  ).run();
  db.prepare(
    `INSERT INTO securities (id, symbol, name, security_type) VALUES ('sec_AAPL', 'AAPL', 'Apple', 'equity')`,
  ).run();
  db.prepare(`INSERT INTO holding_snapshots (id, account_id, as_of) VALUES ('snap', 'schwab_alloc', '2026-10-30T20:05:00.000Z')`).run();
  db.prepare(
    `INSERT INTO positions (id, snapshot_id, security_id, quantity, market_value) VALUES ('pos', 'snap', 'sec_AAPL', 10, 1000)`,
  ).run();
  return db;
}

function netSpot(db: Database.Database, tradeDate: string): number | null {
  const row = db
    .prepare(
      `SELECT spot_market_value AS spot FROM allocation_daily_underlying
       WHERE trade_date = ? AND data_mode = 'schwab' AND scope = 'net' AND symbol = 'AAPL'`,
    )
    .get(tradeDate) as { spot: number } | undefined;
  return row?.spot ?? null;
}

describe("allocation daily close stamp", () => {
  it("stamps a weekday only at or after 16:00 ET, including across DST", () => {
    assert.equal(allocationDailyCloseTradeDate(new Date("2026-10-30T19:59:00.000Z")), null);
    assert.equal(allocationDailyCloseTradeDate(new Date("2026-10-30T20:00:00.000Z")), "2026-10-30");
    assert.equal(allocationDailyCloseTradeDate(new Date("2026-11-02T20:59:00.000Z")), null);
    assert.equal(allocationDailyCloseTradeDate(new Date("2026-11-02T21:00:00.000Z")), "2026-11-02");
  });

  it("does not stamp Sunday or a full-day NYSE holiday onto the prior session", () => {
    assert.equal(allocationDailyCloseTradeDate(new Date("2026-11-01T22:00:00.000Z")), null);
    assert.equal(allocationDailyCloseTradeDate(new Date("2026-11-26T21:30:00.000Z")), null);
    assert.equal(
      shouldWriteAllocationDailyClose(new Date("2026-11-01T22:00:00.000Z"), "2026-10-30", null),
      false,
    );
  });

  it("replaces a pre-close row and keeps the first post-close row", () => {
    const beforeClose = "2026-10-30 19:00:00";
    const afterClose = "2026-10-30 20:10:00";
    const atClose = new Date("2026-10-30T20:30:00.000Z");
    const later = new Date("2026-10-30T22:00:00.000Z");
    assert.equal(shouldWriteAllocationDailyClose(atClose, "2026-10-30", beforeClose), true);
    assert.equal(shouldWriteAllocationDailyClose(later, "2026-10-30", afterClose), false);
  });
});

describe("recordAllocationDailyClose", () => {
  it("does not store Sunday marks as Friday's close", () => {
    const db = createTestDb();
    const sunday = new Date("2026-11-01T22:00:00.000Z");
    const written = recordAllocationDailyClose(db, "2026-10-30", "schwab", "main", sunday);
    assert.equal(written.rowsWritten, 0);
    assert.equal(netSpot(db, "2026-10-30"), null);
  });

  it("replaces the intraday row at the cash close and ignores a later sync", () => {
    const db = createTestDb();
    db.prepare(
      `INSERT INTO allocation_daily_underlying (
         trade_date, data_mode, scope, symbol, spot_market_value, synthetic_market_value, created_at
       ) VALUES ('2026-10-30', 'schwab', 'net', 'AAPL', 1, 0, '2026-10-30 19:00:00')`,
    ).run();

    const atClose = new Date("2026-10-30T20:30:00.000Z");
    const first = recordAllocationDailyClose(db, "2026-10-30", "schwab", "main", atClose);
    assert.ok(first.rowsWritten > 0);
    assert.equal(netSpot(db, "2026-10-30"), 1000);

    db.prepare(`UPDATE positions SET market_value = 50 WHERE id = 'pos'`).run();
    const later = recordAllocationDailyClose(db, "2026-10-30", "schwab", "main", new Date("2026-10-30T23:30:00.000Z"));
    assert.equal(later.rowsWritten, 0);
    assert.equal(netSpot(db, "2026-10-30"), 1000);
  });
});

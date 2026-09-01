import fs from "node:fs";
import path from "node:path";

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";

import { isoDateUtc } from "./dates";
import {
  captureBookForwardSnap,
  ensureBookLiveStartedAt,
  hasBookForwardSnapGaps,
  latestBookSnapAsOf,
  needsBookForwardSnapCapture,
} from "./bookForwardSnap";
import { dividendBookHoldingQuantities } from "./schwabDividendBook";
import type { SchwabDividendBookRow } from "./schwabDividendBook";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  const schemaPath = path.join(process.cwd(), "src", "db", "schema.sql");
  db.exec(fs.readFileSync(schemaPath, "utf-8"));
  return db;
}

describe("bookForwardSnap", () => {
  it("dividendBookHoldingQuantities uses aggregated share counts", () => {
    const rows = [
      {
        symbol: "VTI",
        shares: 15,
        holdingId: "VTI",
        sortOrder: 0,
        displayName: null,
        last: null,
        divYield: 0.02,
        annualDivEst: 2,
        marketValue: 1000,
        nextExDate: null,
        sector: null,
        industry: null,
        avgUnitCost: 100,
        category: "ETF",
        cost: 1500,
        accountsLabel: "A, B",
        accountIds: ["a", "b"],
      },
    ] as SchwabDividendBookRow[];
    const q = dividendBookHoldingQuantities(rows);
    assert.equal(q.length, 1);
    assert.equal(q[0]!.shares, 15);
  });

  it("ensureBookLiveStartedAt creates meta row", () => {
    const db = createTestDb();
    const iso = ensureBookLiveStartedAt(db);
    assert.ok(iso.length > 10);
    const row = db.prepare(`SELECT live_started_at FROM dividend_book_meta WHERE id = 'default'`).get() as {
      live_started_at: string;
    };
    assert.equal(row.live_started_at, iso);
  });

  it("captureBookForwardSnap returns false when no dividend holdings", async () => {
    const db = createTestDb();
    const res = await captureBookForwardSnap(db);
    assert.equal(res.ok, false);
  });

  it("needsBookForwardSnapCapture when no rows exist", () => {
    const db = createTestDb();
    assert.equal(needsBookForwardSnapCapture(db, new Date("2026-05-22T15:00:00Z")), true);
  });

  it("needsBookForwardSnapCapture is false when today already captured", () => {
    const db = createTestDb();
    const now = new Date("2026-05-22T15:00:00Z");
    const today = isoDateUtc(now);
    db.prepare(
      `INSERT INTO dividend_book_forward_snap (as_of, nav_total, dividends_period, status, computed_at) VALUES (?, 1000, 0, 'partial', ?)`,
    ).run(today, now.toISOString());
    assert.equal(needsBookForwardSnapCapture(db, now), false);
    assert.equal(latestBookSnapAsOf(db), today);
  });

  it("hasBookForwardSnapGaps when live start predates stored snaps", () => {
    const db = createTestDb();
    const now = new Date("2026-05-22T15:00:00Z");
    ensureBookLiveStartedAt(db, now);
    db.prepare(
      `INSERT INTO dividend_book_forward_snap (as_of, nav_total, dividends_period, status, computed_at) VALUES ('2026-05-22', 1000, 0, 'partial', ?)`,
    ).run(now.toISOString());
    assert.equal(hasBookForwardSnapGaps(db, now), true);
  });
});

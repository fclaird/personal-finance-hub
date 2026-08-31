import fs from "node:fs";
import path from "node:path";

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";

import { captureBookForwardSnap, ensureBookLiveStartedAt, persistBookForwardSnap } from "./bookForwardSnap";
import { fridayOfUtcWeekContaining } from "./dates";
import { persistPortfolioForwardSnap } from "./forwardSnap";
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

  it("persistBookForwardSnap does not null-overwrite a stored weekly NAV", () => {
    const db = createTestDb();
    persistBookForwardSnap(db, "2026-08-28", 125_000, 10, "2026-08-27T12:00:00.000Z");
    persistBookForwardSnap(db, "2026-08-28", 0, 12, "2026-08-28T18:00:00.000Z");
    const row = db.prepare(`SELECT nav_total, dividends_period FROM dividend_book_forward_snap WHERE as_of = '2026-08-28'`).get() as {
      nav_total: number | null;
      dividends_period: number;
    };
    assert.equal(row.nav_total, 125_000);
    assert.equal(row.dividends_period, 12);
  });

  it("persistBookForwardSnap updates NAV when the new value is positive", () => {
    const db = createTestDb();
    persistBookForwardSnap(db, "2026-08-28", 125_000, 10, "2026-08-27T12:00:00.000Z");
    persistBookForwardSnap(db, "2026-08-28", 130_000, 11, "2026-08-28T18:00:00.000Z");
    const row = db.prepare(`SELECT nav_total FROM dividend_book_forward_snap WHERE as_of = '2026-08-28'`).get() as {
      nav_total: number | null;
    };
    assert.equal(row.nav_total, 130_000);
  });

  it("persistPortfolioForwardSnap does not null-overwrite a stored weekly NAV", () => {
    const db = createTestDb();
    db.prepare(`INSERT INTO dividend_model_portfolios (id, name) VALUES ('p1', 'Test')`).run();
    persistPortfolioForwardSnap(db, "p1", "2026-08-28", 80_000, 5, "2026-08-27T12:00:00.000Z");
    persistPortfolioForwardSnap(db, "p1", "2026-08-28", 0, 6, "2026-08-28T18:00:00.000Z");
    const row = db
      .prepare(`SELECT nav_total, dividends_period FROM dividend_model_portfolio_forward_snap WHERE portfolio_id = 'p1' AND as_of = '2026-08-28'`)
      .get() as { nav_total: number | null; dividends_period: number };
    assert.equal(row.nav_total, 80_000);
    assert.equal(row.dividends_period, 6);
  });

  it("captureBookForwardSnap keeps prior NAV when Schwab quotes fail", async () => {
    const db = createTestDb();
    db.prepare(
      `INSERT OR IGNORE INTO institution_connections (id, type, display_name, status) VALUES ('conn1', 'schwab', 'Test', 'active')`,
    ).run();
    db.prepare(
      `INSERT INTO accounts (id, connection_id, name, nickname, type) VALUES ('schwab_a', 'conn1', 'Schwab', 'Main', 'brokerage')`,
    ).run();
    db.prepare(`INSERT INTO holding_snapshots (id, account_id, as_of) VALUES ('snap_a', 'schwab_a', '2026-08-28T12:00:00Z')`).run();
    db.prepare(`INSERT INTO securities (id, symbol, name, security_type) VALUES ('sec_VTI', 'VTI', 'VTI', 'equity')`).run();
    db.prepare(
      `INSERT INTO positions (id, snapshot_id, security_id, quantity, price, market_value) VALUES ('pos_vti', 'snap_a', 'sec_VTI', 10, 100, 1100)`,
    ).run();
    db.prepare(
      `INSERT INTO symbol_dividend_payments (symbol, pay_date, amount, captured_at) VALUES ('VTI', '2024-01-01', 1, datetime('now'))`,
    ).run();

    const asOf = fridayOfUtcWeekContaining(new Date());
    persistBookForwardSnap(db, asOf, 50_000, 0, "2026-08-27T12:00:00.000Z");

    const res = await captureBookForwardSnap(db, new Date(), { fetchLiveQuotes: false });
    assert.equal(res.ok, true);
    assert.equal(res.asOf, asOf);
    const row = db.prepare(`SELECT nav_total FROM dividend_book_forward_snap WHERE as_of = ?`).get(asOf) as {
      nav_total: number | null;
    };
    assert.equal(row.nav_total, 50_000);
  });
});

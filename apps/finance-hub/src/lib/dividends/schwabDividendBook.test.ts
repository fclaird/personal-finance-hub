import fs from "node:fs";
import path from "node:path";

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";

import {
  aggregateBySymbol,
  buildSchwabDividendBook,
  computeDividendBookBanner,
  loadLatestSchwabPositionRows,
} from "./schwabDividendBook";
import { enrichSymbolHoldings } from "@/lib/dividends/symbolEnrichment";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  const schemaPath = path.join(process.cwd(), "src", "db", "schema.sql");
  db.exec(fs.readFileSync(schemaPath, "utf-8"));
  return db;
}

function seedSchwabAccount(
  db: Database.Database,
  accountId: string,
  nickname: string,
  snapshotId: string,
  asOf: string,
) {
  db.prepare(
    `INSERT OR IGNORE INTO institution_connections (id, type, display_name, status) VALUES ('conn1', 'schwab', 'Test', 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO accounts (id, connection_id, name, nickname, type) VALUES (?, 'conn1', ?, ?, 'brokerage')`,
  ).run(accountId, `Schwab ${accountId}`, nickname);
  db.prepare(`INSERT INTO holding_snapshots (id, account_id, as_of) VALUES (?, ?, ?)`).run(snapshotId, accountId, asOf);
}

function seedEquityPosition(
  db: Database.Database,
  snapshotId: string,
  symbol: string,
  qty: number,
  price: number,
  mv: number,
) {
  const secId = `sec_${symbol}`;
  db.prepare(
    `INSERT OR IGNORE INTO securities (id, symbol, name, security_type) VALUES (?, ?, ?, 'equity')`,
  ).run(secId, symbol, symbol);
  db.prepare(
    `INSERT INTO positions (id, snapshot_id, security_id, quantity, price, market_value) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(`pos_${snapshotId}_${symbol}`, snapshotId, secId, qty, price, mv);
}

describe("schwabDividendBook", () => {
  it("aggregateBySymbol merges same ticker across accounts with account labels", () => {
    const db = createTestDb();
    seedSchwabAccount(db, "schwab_a", "IRA", "snap_a", "2025-06-01T12:00:00Z");
    seedSchwabAccount(db, "schwab_b", "Taxable", "snap_b", "2025-06-02T12:00:00Z");
    seedEquityPosition(db, "snap_a", "VTI", 10, 100, 1100);
    seedEquityPosition(db, "snap_b", "VTI", 5, 100, 550);

    const rows = loadLatestSchwabPositionRows(db);
    assert.equal(rows.length, 2);
    const agg = aggregateBySymbol(rows);
    assert.equal(agg.length, 1);
    assert.equal(agg[0]!.symbol, "VTI");
    assert.equal(agg[0]!.shares, 15);
    assert.equal(agg[0]!.snapshotMarketValue, 1650);
    assert.ok(agg[0]!.accountLabels.includes("IRA"));
    assert.ok(agg[0]!.accountLabels.includes("Taxable"));
  });

  it("excludes Aurora-exclusive Schwab accounts from parent dividend rows", () => {
    const db = createTestDb();
    seedSchwabAccount(db, "schwab_94558855", "Aurora", "snap_aurora", "2025-06-01T12:00:00Z");
    seedSchwabAccount(db, "schwab_parent", "Parent", "snap_parent", "2025-06-01T12:00:00Z");
    seedEquityPosition(db, "snap_aurora", "AUR", 10, 100, 1000);
    seedEquityPosition(db, "snap_parent", "VTI", 5, 100, 500);

    const rows = loadLatestSchwabPositionRows(db);
    assert.deepEqual(rows.map((r) => r.symbol), ["VTI"]);
  });

  it("computeDividendBookBanner calculates MV share and yields", async () => {
    const db = createTestDb();
    const all = await enrichSymbolHoldings(db, [
      { holdingId: "VTI", symbol: "VTI", shares: 100, sortOrder: 0, avgUnitCost: 50 },
      { holdingId: "GROW", symbol: "GROW", shares: 10, sortOrder: 1, avgUnitCost: 200 },
    ]);
    const vti = { ...all[0]!, marketValue: 10000, annualDivEst: 2, divYield: 0.02 };
    const grow = { ...all[1]!, marketValue: 5000, annualDivEst: 0, divYield: 0 };
    const banner = computeDividendBookBanner([vti, grow], [vti], "2025-06-01");
    assert.equal(banner.totalEquityMarketValue, 15000);
    assert.equal(banner.dividendMarketValue, 10000);
    assert.ok(Math.abs((banner.dividendShareOfBookPct ?? 0) - (10000 / 15000) * 100) < 0.01);
    assert.ok((banner.combinedBookYieldPct ?? 0) > 0);
    assert.ok((banner.dividendSliceYieldPct ?? 0) > 0);
  });

  it("includes mutual funds stored as security_type other with MUTUAL_FUND metadata", () => {
    const db = createTestDb();
    seedSchwabAccount(db, "schwab_m", "Brokerage", "snap_m", "2025-06-01T12:00:00Z");
    const secId = "sec_FWADX";
    db.prepare(`INSERT INTO securities (id, symbol, name, security_type) VALUES (?, 'FWADX', 'FWADX', 'other')`).run(
      secId,
    );
    db.prepare(
      `INSERT INTO positions (id, snapshot_id, security_id, quantity, price, market_value, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "pos_fwadx",
      "snap_m",
      secId,
      100,
      10,
      1000,
      JSON.stringify({ instrument: { assetType: "MUTUAL_FUND", symbol: "FWADX" } }),
    );

    const rows = loadLatestSchwabPositionRows(db);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.symbol, "FWADX");
    assert.equal(rows[0]!.assetType, "MUTUAL_FUND");
  });

  it("buildSchwabDividendBook excludes non-dividend symbols from dividend rows", async () => {
    const db = createTestDb();
    seedSchwabAccount(db, "schwab_x", "Main", "snap_x", "2025-06-01T12:00:00Z");
    seedEquityPosition(db, "snap_x", "VTI", 10, 100, 1100);
    seedEquityPosition(db, "snap_x", "NODIV", 5, 50, 300);
    db.prepare(
      `INSERT INTO symbol_dividend_payments (symbol, pay_date, amount, captured_at) VALUES ('VTI', '2024-01-01', 1, datetime('now'))`,
    ).run();

    const book = await buildSchwabDividendBook(db);
    assert.equal(book.dividendRows.length, 1);
    assert.equal(book.dividendRows[0]!.symbol, "VTI");
    assert.equal(book.allEquityRows.length, 2);
    assert.ok((book.banner.dividendShareOfBookPct ?? 0) > 0);
  });
});

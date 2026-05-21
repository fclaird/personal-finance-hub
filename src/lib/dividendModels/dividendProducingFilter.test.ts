import fs from "node:fs";
import path from "node:path";

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";

import type { EnrichedHoldingRow } from "./enrichedHoldings";
import {
  filterDividendProducingHoldings,
  holdingQualifiesForDividendsTab,
  holdingRowIsDividendProducer,
  symbolIsDividendProducer,
} from "./dividendProducingFilter";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  const schemaPath = path.join(process.cwd(), "src", "db", "schema.sql");
  db.exec(fs.readFileSync(schemaPath, "utf-8"));
  return db;
}

function row(overrides: Partial<EnrichedHoldingRow> & { symbol: string }): EnrichedHoldingRow {
  const { symbol, shares, divYield, annualDivEst, ...rest } = overrides;
  return {
    holdingId: "h1",
    displayName: null,
    sortOrder: 0,
    last: 100,
    marketValue: 1000,
    nextExDate: null,
    sector: null,
    industry: null,
    avgUnitCost: null,
    category: "Equity",
    cost: 1000,
    symbol,
    shares: shares ?? 10,
    divYield: divYield ?? null,
    annualDivEst: annualDivEst ?? null,
    ...rest,
  };
}

describe("dividendProducingFilter", () => {
  it("symbolIsDividendProducer detects payment history", () => {
    const db = createTestDb();
    db.prepare(
      `INSERT INTO symbol_dividend_payments (symbol, pay_date, amount, captured_at) VALUES ('AAPL', '2024-01-15', 0.24, datetime('now'))`,
    ).run();
    assert.equal(symbolIsDividendProducer(db, "AAPL"), true);
    assert.equal(symbolIsDividendProducer(db, "NOPE"), false);
  });

  it("holdingRowIsDividendProducer uses enriched yield fields", () => {
    const db = createTestDb();
    assert.equal(holdingRowIsDividendProducer(db, row({ symbol: "X", divYield: 0.02 })), true);
    assert.equal(holdingRowIsDividendProducer(db, row({ symbol: "Y", annualDivEst: 1.5 })), true);
    assert.equal(holdingRowIsDividendProducer(db, row({ symbol: "Z", divYield: null, annualDivEst: null })), false);
  });

  it("filterDividendProducingHoldings keeps only dividend names", () => {
    const db = createTestDb();
    db.prepare(
      `INSERT INTO symbol_dividend_payments (symbol, pay_date, amount, captured_at) VALUES ('VTI', '2024-02-01', 0.8, datetime('now'))`,
    ).run();
    const rows = [
      row({ symbol: "VTI", divYield: null, annualDivEst: null }),
      row({ symbol: "GROW", divYield: null, annualDivEst: null }),
    ];
    const filtered = filterDividendProducingHoldings(db, rows);
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]!.symbol, "VTI");
  });

  it("holdingQualifiesForDividendsTab requires positive shares", () => {
    const db = createTestDb();
    db.prepare(
      `INSERT INTO symbol_dividend_payments (symbol, pay_date, amount, captured_at) VALUES ('SPY', '2024-03-01', 1.5, datetime('now'))`,
    ).run();
    assert.equal(holdingQualifiesForDividendsTab(db, "SPY", 5), true);
    assert.equal(holdingQualifiesForDividendsTab(db, "SPY", 0), false);
    assert.equal(holdingQualifiesForDividendsTab(db, "SPY", null), false);
  });
});

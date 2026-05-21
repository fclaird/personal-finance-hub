import fs from "node:fs";
import path from "node:path";

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";

import { buildLivePortfolioDashboard } from "./livePortfolioDashboard";
import type { EnrichedHoldingRow } from "./enrichedHoldings";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  const schemaPath = path.join(process.cwd(), "src", "db", "schema.sql");
  db.exec(fs.readFileSync(schemaPath, "utf-8"));
  return db;
}

describe("buildLivePortfolioDashboard", () => {
  it("uses cashflow rows not simulated monthly dividends", () => {
    const db = createTestDb();
    const portfolioId = "p-live";
    db.prepare(
      `INSERT INTO dividend_model_portfolios (id, name, live_started_at, tracking_mode, meta_json) VALUES (?, 'Test', NULL, 'live', NULL)`,
    ).run(portfolioId);

    db.prepare(
      `INSERT INTO institution_connections (id, type, display_name, status) VALUES ('conn1', 'schwab', 'Test', 'active')`,
    ).run();
    db.prepare(
      `INSERT INTO accounts (id, connection_id, name, type) VALUES ('acct1', 'conn1', 'Test', 'brokerage')`,
    ).run();
    db.prepare(`INSERT INTO securities (id, symbol, name, security_type) VALUES ('sec-vti', 'VTI', 'VTI', 'fund')`).run();
    db.prepare(
      `INSERT INTO cashflows (id, account_id, security_id, type, amount, pay_date) VALUES ('cf1', 'acct1', 'sec-vti', 'dividend_actual', 50, '2025-01-10')`,
    ).run();

    db.prepare(
      `INSERT INTO dividend_model_portfolio_sim_monthly (portfolio_id, month_end, simulation_mode, total_dividends, nav_total, status, computed_at) VALUES (?, '2025-01-31', 'withdraw', 9999, 100000, 'ok', datetime('now'))`,
    ).run(portfolioId);

    const holdings: EnrichedHoldingRow[] = [
      {
        holdingId: "h1",
        symbol: "VTI",
        displayName: "VTI",
        shares: 10,
        sortOrder: 0,
        last: 200,
        divYield: 0.015,
        annualDivEst: 3,
        marketValue: 2000,
        nextExDate: null,
        sector: null,
        industry: null,
        avgUnitCost: 150,
        category: "ETF",
        cost: 1500,
      },
    ];

    const dash = buildLivePortfolioDashboard(db, portfolioId, holdings);
    assert.equal(dash.income.allTime, 50);
    assert.notEqual(dash.income.allTime, 9999);
  });
});

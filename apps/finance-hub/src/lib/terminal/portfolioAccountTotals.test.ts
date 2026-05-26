import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";

import {
  externalMarketValueFromDb,
  priorNySessionYmd,
  schwabLiquidationFromDb,
} from "@/lib/terminal/portfolioAccountTotals";
import { PORTFOLIO_INDEX_BASE, portfolioIndexFromSpyIndex } from "@/lib/terminal/portfolioGlance";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  const schemaPath = path.join(process.cwd(), "src", "db", "schema.sql");
  db.exec(fs.readFileSync(schemaPath, "utf-8"));
  return db;
}

test("priorNySessionYmd skips weekends", () => {
  assert.equal(priorNySessionYmd("2026-05-25"), "2026-05-22");
});

test("portfolioIndexFromSpyIndex scales SPY path to portfolio day change", () => {
  const spyEnd = 101.6;
  const portfolioEnd = 103;
  assert.equal(portfolioIndexFromSpyIndex(PORTFOLIO_INDEX_BASE, spyEnd, portfolioEnd), PORTFOLIO_INDEX_BASE);
  assert.equal(portfolioIndexFromSpyIndex(spyEnd, spyEnd, portfolioEnd), portfolioEnd);
  const mid = portfolioIndexFromSpyIndex(100.8, spyEnd, portfolioEnd);
  assert.ok(mid > PORTFOLIO_INDEX_BASE);
  assert.ok(mid < portfolioEnd);
});

test("schwabLiquidationFromDb sums latest account value points", () => {
  const db = createTestDb();
  db.prepare(
    `INSERT INTO institution_connections (id, type, display_name, status) VALUES ('c1', 'schwab', 'S', 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO accounts (id, connection_id, name, account_bucket, type) VALUES ('schwab_a', 'c1', 'Taxable', 'brokerage', 'brokerage')`,
  ).run();
  db.prepare(
    `INSERT INTO accounts (id, connection_id, name, account_bucket, type) VALUES ('schwab_b', 'c1', 'IRA', 'retirement', 'retirement')`,
  ).run();
  db.prepare(
    `INSERT INTO account_value_points (account_id, as_of, equity_value, cash_value, source) VALUES ('schwab_a', '2026-05-22T10:00:00Z', 4000000, 10000, 'schwab_balances')`,
  ).run();
  db.prepare(
    `INSERT INTO account_value_points (account_id, as_of, equity_value, cash_value, source) VALUES ('schwab_b', '2026-05-22T10:00:00Z', 1000000, 0, 'schwab_balances')`,
  ).run();

  const { current } = schwabLiquidationFromDb(db);
  assert.equal(current, 5000000);
});

test("externalMarketValueFromDb adds manual 529 holdings", () => {
  const db = createTestDb();
  db.prepare(
    `INSERT INTO institution_connections (id, type, display_name, status) VALUES ('conn_manual', 'manual', 'Manual', 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO accounts (id, connection_id, name, account_bucket, type) VALUES ('manual_529', 'conn_manual', '529', '529', 'manual')`,
  ).run();
  db.prepare(`INSERT INTO holding_snapshots (id, account_id, as_of) VALUES ('snap529', 'manual_529', '2026-05-22')`).run();
  db.prepare(`INSERT INTO securities (id, symbol, name, security_type) VALUES ('sec_529', '529FUND', '529 Fund', 'fund')`).run();
  db.prepare(
    `INSERT INTO positions (id, snapshot_id, security_id, quantity, price, market_value) VALUES ('p529', 'snap529', 'sec_529', 1, 250000, 250000)`,
  ).run();

  const { current } = externalMarketValueFromDb(db, "2026-05-21");
  assert.equal(current, 250000);
});

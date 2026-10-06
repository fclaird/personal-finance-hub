import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";

import { RORIE_ACCOUNT_ID } from "@/lib/flavors/registry";
import {
  externalMarketValueFromDb,
  priorNySessionYmd,
  resolveStoredSchwabBaseline,
  sumExternalPositionsWithNav,
  schwabIntradayTotalsFromDb,
  schwabLiquidationFromDb,
  schwabPriorEquityFromLatestSync,
  schwabLiquidationOnSession,
} from "@/lib/terminal/portfolioAccountTotals";
import {
  buildPortfolioIndexSeries,
  PORTFOLIO_INDEX_BASE,
  portfolioIndexFromSpyIndex,
} from "@/lib/terminal/portfolioGlance";

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

test("externalMarketValueFromDb uses current external when prior snapshot is missing (not zero)", () => {
  const db = createTestDb();
  db.prepare(
    `INSERT INTO institution_connections (id, type, display_name, status) VALUES ('conn_manual', 'manual', 'Manual', 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO accounts (id, connection_id, name, account_bucket, type) VALUES ('manual_529', 'conn_manual', '529', '529', 'manual')`,
  ).run();
  db.prepare(
    `INSERT INTO holding_snapshots (id, account_id, as_of) VALUES ('snap529', 'manual_529', '2026-05-28T12:00:00Z')`,
  ).run();
  db.prepare(`INSERT INTO securities (id, symbol, name, security_type) VALUES ('sec_529', '529FUND', '529 Fund', 'fund')`).run();
  db.prepare(
    `INSERT INTO positions (id, snapshot_id, security_id, quantity, price, market_value) VALUES ('p529', 'snap529', 'sec_529', 1, 250000, 250000)`,
  ).run();

  const { current, prior } = externalMarketValueFromDb(db, "2026-05-27");
  assert.equal(current, 250000);
  assert.equal(prior, 250000);
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

test("schwabLiquidationOnSession uses the ET session date, not the UTC date", () => {
  const db = createTestDb();
  db.prepare(
    `INSERT INTO institution_connections (id, type, display_name, status) VALUES ('c1', 'schwab', 'S', 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO accounts (id, connection_id, name, account_bucket, type) VALUES ('schwab_a', 'c1', 'Taxable', 'brokerage', 'brokerage')`,
  ).run();
  db.prepare(
    `INSERT INTO account_value_points (account_id, as_of, equity_value, cash_value, source) VALUES ('schwab_a', '2026-05-21T14:00:00.000Z', 1000000, 0, 'schwab_balances')`,
  ).run();
  // Thursday 21:00 ET is Friday 01:00 UTC. SQL date() would drop it from Thursday.
  db.prepare(
    `INSERT INTO account_value_points (account_id, as_of, equity_value, cash_value, source) VALUES ('schwab_a', '2026-05-22T01:00:00.000Z', 1010000, 0, 'schwab_balances')`,
  ).run();
  db.prepare(
    `INSERT INTO account_value_points (account_id, as_of, equity_value, cash_value, source) VALUES ('schwab_a', '2026-05-22T20:00:00.000Z', 400000, 0, 'schwab_balances')`,
  ).run();

  const { prior } = schwabLiquidationOnSession(db, "2026-05-21");
  assert.equal(prior, 1010000);
});

test("schwabPriorEquityFromLatestSync reads prior-day equity from the latest sync row", () => {
  const db = createTestDb();
  db.prepare(
    `INSERT INTO institution_connections (id, type, display_name, status) VALUES ('c1', 'schwab', 'S', 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO accounts (id, connection_id, name, account_bucket, type) VALUES ('schwab_a', 'c1', 'Taxable', 'brokerage', 'brokerage')`,
  ).run();
  db.prepare(
    `INSERT INTO account_value_points (account_id, as_of, equity_value, cash_value, prior_equity_value, source) VALUES ('schwab_a', '2026-05-22T10:00:00Z', 1001100, 0, 1000000, 'schwab_balances')`,
  ).run();

  const { prior } = schwabPriorEquityFromLatestSync(db);
  assert.equal(prior, 1000000);
});

test("schwabIntradayTotalsFromDb excludes UTC-midnight rows that are prior evening in ET", () => {
  const db = createTestDb();
  db.prepare(
    `INSERT INTO institution_connections (id, type, display_name, status) VALUES ('c1', 'schwab', 'S', 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO accounts (id, connection_id, name, account_bucket, type) VALUES ('schwab_a', 'c1', 'Taxable', 'brokerage', 'brokerage')`,
  ).run();
  db.prepare(
    `INSERT INTO account_value_points (account_id, as_of, equity_value, cash_value, source) VALUES ('schwab_a', '2026-05-28T00:04:55.748Z', 1001000, 0, 'schwab_balances')`,
  ).run();
  db.prepare(
    `INSERT INTO account_value_points (account_id, as_of, equity_value, cash_value, source) VALUES ('schwab_a', '2026-05-28T14:00:00.000Z', 1001100, 0, 'schwab_balances')`,
  ).run();

  assert.equal(schwabIntradayTotalsFromDb(db, "2026-05-28").length, 1);
  assert.equal(schwabIntradayTotalsFromDb(db, "2026-05-27").length, 1);
});

test("schwabIntradayTotalsFromDb keeps same-day liquidation points", () => {
  const db = createTestDb();
  db.prepare(
    `INSERT INTO institution_connections (id, type, display_name, status) VALUES ('c1', 'schwab', 'S', 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO accounts (id, connection_id, name, account_bucket, type) VALUES ('schwab_a', 'c1', 'Taxable', 'brokerage', 'brokerage')`,
  ).run();
  db.prepare(
    `INSERT INTO account_value_points (account_id, as_of, equity_value, cash_value, source) VALUES ('schwab_a', '2026-05-22T13:30:00Z', 1001000, 0, 'schwab_balances')`,
  ).run();
  db.prepare(
    `INSERT INTO account_value_points (account_id, as_of, equity_value, cash_value, source) VALUES ('schwab_a', '2026-05-22T15:30:00Z', 1001100, 0, 'schwab_balances')`,
  ).run();
  db.prepare(
    `INSERT INTO account_value_points (account_id, as_of, equity_value, cash_value, source) VALUES ('schwab_a', '2026-05-21T21:00:00Z', 1000000, 0, 'schwab_balances')`,
  ).run();

  const points = schwabIntradayTotalsFromDb(db, "2026-05-22");
  assert.equal(points.length, 2);
  assert.equal(points[0]!.total, 1001000);
  assert.equal(points[1]!.total, 1001100);
});

test("buildPortfolioIndexSeries adjusts day end for net withdrawals", () => {
  const priorNetValue = 1_050_000;
  const external = 50_000;
  const withdrawal = -50_000;
  const rawNetValue = priorNetValue * 1.0011 + withdrawal;
  const nowMs = Date.parse("2026-05-22T17:30:00.000Z");
  const series = buildPortfolioIndexSeries([], priorNetValue, rawNetValue, "2026-05-22", nowMs, external, withdrawal);
  assert.equal(series.length, 2);
  assert.ok(Math.abs(series[1]!.close - 100.11) < 0.01);
});

test("buildPortfolioIndexSeries maps liquidation path to day percent", () => {
  const priorNetValue = 1_050_000;
  const external = 50_000;
  const netValue = priorNetValue * 1.0011;
  const openMs = Date.parse("2026-05-22T13:30:00.000Z");
  const laterMs = Date.parse("2026-05-22T15:30:00.000Z");
  const series = buildPortfolioIndexSeries(
    [
      { tsMs: openMs, total: 1_000_525 },
      { tsMs: laterMs, total: 1_001_150 },
    ],
    priorNetValue,
    netValue,
    "2026-05-22",
    laterMs,
    external,
  );
  assert.equal(series.length, 2);
  assert.ok(Math.abs(series[0]!.close - 100.05) < 0.01);
  assert.ok(Math.abs(series[1]!.close - 100.11) < 0.01);
});

test("buildPortfolioIndexSeries preserves intraday shape when sync tail disagrees with live totals", () => {
  const priorNetValue = 1_050_000;
  const external = 50_000;
  const netValue = priorNetValue * 1.0018;
  const openMs = Date.parse("2026-05-22T13:30:00.000Z");
  const midMs = Date.parse("2026-05-22T15:30:00.000Z");
  const laterMs = Date.parse("2026-05-22T16:30:00.000Z");
  const nowMs = Date.parse("2026-05-22T17:30:00.000Z");
  const series = buildPortfolioIndexSeries(
    [
      { tsMs: openMs, total: 995_000 },
      { tsMs: midMs, total: 993_000 },
      { tsMs: laterMs, total: 994_000 },
    ],
    priorNetValue,
    netValue,
    "2026-05-22",
    nowMs,
    external,
  );
  assert.equal(series.length, 3);
  assert.ok(Math.abs(series[0]!.close - 100) < 0.01);
  assert.ok(Math.abs(series[series.length - 1]!.close - 100.18) < 0.05);
});

test("buildPortfolioIndexSeries preserves full path after withdrawal cash flow", () => {
  const priorNetValue = 5_258_000;
  const external = 250_000;
  const netValue = 5_351_000;
  const withdrawal = -50_000;
  const openMs = Date.parse("2026-05-27T13:30:00.000Z");
  const midMs = Date.parse("2026-05-27T15:30:00.000Z");
  const closeMs = Date.parse("2026-05-27T20:00:00.000Z");
  const series = buildPortfolioIndexSeries(
    [
      { tsMs: openMs, total: 5_044_850 },
      { tsMs: midMs, total: 5_020_000 },
      { tsMs: closeMs, total: 5_002_758 },
    ],
    priorNetValue,
    netValue,
    "2026-05-27",
    closeMs,
    external,
    withdrawal,
  );
  assert.equal(series.length, 3);
  assert.ok(Math.abs(series[0]!.close - 100) < 0.01);
  const expectedLast = PORTFOLIO_INDEX_BASE * ((netValue - withdrawal) / priorNetValue);
  assert.ok(Math.abs(series[series.length - 1]!.close - expectedLast) < 0.05);
});

test("externalMarketValueFromDb prior snapshot uses the ET session date", () => {
  const db = createTestDb();
  db.prepare(
    `INSERT INTO institution_connections (id, type, display_name, status) VALUES ('conn_manual', 'manual', 'Manual', 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO accounts (id, connection_id, name, account_bucket, type) VALUES ('manual_529', 'conn_manual', '529', '529', 'manual')`,
  ).run();
  db.prepare(
    `INSERT INTO holding_snapshots (id, account_id, as_of) VALUES ('snapLate', 'manual_529', '2026-05-28T00:04:55.748Z')`,
  ).run();
  db.prepare(
    `INSERT INTO holding_snapshots (id, account_id, as_of) VALUES ('snapPrior', 'manual_529', '2026-05-27T16:00:00.000Z')`,
  ).run();
  db.prepare(`INSERT INTO securities (id, symbol, name, security_type) VALUES ('sec_529', '529FUND', '529 Fund', 'fund')`).run();
  db.prepare(
    `INSERT INTO positions (id, snapshot_id, security_id, quantity, price, market_value) VALUES ('pLate', 'snapLate', 'sec_529', 1, 260000, 260000)`,
  ).run();
  db.prepare(
    `INSERT INTO positions (id, snapshot_id, security_id, quantity, price, market_value) VALUES ('pPrior', 'snapPrior', 'sec_529', 1, 250000, 250000)`,
  ).run();

  const { current, prior } = externalMarketValueFromDb(db, "2026-05-27");
  assert.equal(current, 260000);
  assert.equal(prior, 260000);
});

test("sumExternalPositionsWithNav marks 529 plan funds to public NAV", () => {
  const nav = 280;
  const mv = sumExternalPositionsWithNav(
    [
      {
        accountId: "manual_529",
        accountBucket: "529",
        securityType: "fund",
        symbol: "VTI",
        metadataJson: JSON.stringify({
          source: "manual",
          fundBasis: { statementMarketValue: 200000, statementDate: "2026-01-01", basisTickerNav: 250 },
        }),
        quantity: 800,
        price: 250,
        marketValue: 200000,
      },
    ],
    new Map([["VTI", nav]]),
  );
  assert.equal(mv, 200000 * (nav / 250));
});

test("priorNySessionYmd skips a NYSE holiday back to the last open session", () => {
  assert.equal(priorNySessionYmd("2026-05-26"), "2026-05-22");
});

test("a multi-day account-value gap is not the prior session close", () => {
  const db = createTestDb();
  db.prepare(
    `INSERT INTO institution_connections (id, type, display_name, status) VALUES ('c1', 'schwab', 'S', 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO accounts (id, connection_id, name, account_bucket, type) VALUES ('schwab_a', 'c1', 'Taxable', 'brokerage', 'brokerage')`,
  ).run();
  db.prepare(
    `INSERT INTO account_value_points (account_id, as_of, equity_value, cash_value, source) VALUES ('schwab_a', '2026-09-30T16:56:00.000Z', 4770000, 0, 'schwab_balances')`,
  ).run();
  db.prepare(
    `INSERT INTO account_value_points (account_id, as_of, equity_value, cash_value, prior_equity_value, source) VALUES ('schwab_a', '2026-10-06T13:21:00.000Z', 5340000, 0, NULL, 'schwab_balances')`,
  ).run();

  const { prior } = schwabLiquidationOnSession(db, "2026-10-05");
  assert.equal(prior, 0, "Sep 30 print is not the Oct 5 close");
});

test("prior-session liquidation keeps that session when an older print exists", () => {
  const db = createTestDb();
  db.prepare(
    `INSERT INTO institution_connections (id, type, display_name, status) VALUES ('c1', 'schwab', 'S', 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO accounts (id, connection_id, name, account_bucket, type) VALUES ('schwab_a', 'c1', 'Taxable', 'brokerage', 'brokerage')`,
  ).run();
  db.prepare(
    `INSERT INTO account_value_points (account_id, as_of, equity_value, cash_value, source) VALUES ('schwab_a', '2026-09-30T16:56:00.000Z', 4770000, 0, 'schwab_balances')`,
  ).run();
  db.prepare(
    `INSERT INTO account_value_points (account_id, as_of, equity_value, cash_value, source) VALUES ('schwab_a', '2026-10-05T20:00:00.000Z', 5160000, 0, 'schwab_balances')`,
  ).run();

  const { prior } = schwabLiquidationOnSession(db, "2026-10-05");
  assert.equal(prior, 5160000);
});

test("external prior does not treat a pre-session snapshot as yesterday", () => {
  const db = createTestDb();
  db.prepare(
    `INSERT INTO institution_connections (id, type, display_name, status) VALUES ('conn_manual', 'manual', 'Manual', 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO accounts (id, connection_id, name, account_bucket, type) VALUES ('manual_529', 'conn_manual', '529', '529', 'manual')`,
  ).run();
  db.prepare(`INSERT INTO securities (id, symbol, name, security_type) VALUES ('sec_529', '529FUND', '529 Fund', 'fund')`).run();
  db.prepare(
    `INSERT INTO holding_snapshots (id, account_id, as_of) VALUES ('snapOld', 'manual_529', '2026-09-30T16:00:00.000Z')`,
  ).run();
  db.prepare(
    `INSERT INTO holding_snapshots (id, account_id, as_of) VALUES ('snapToday', 'manual_529', '2026-10-06T13:21:00.000Z')`,
  ).run();
  db.prepare(
    `INSERT INTO positions (id, snapshot_id, security_id, quantity, price, market_value) VALUES ('pOld', 'snapOld', 'sec_529', 1, 250000, 250000)`,
  ).run();
  db.prepare(
    `INSERT INTO positions (id, snapshot_id, security_id, quantity, price, market_value) VALUES ('pToday', 'snapToday', 'sec_529', 1, 325920, 325920)`,
  ).run();

  const { current, prior } = externalMarketValueFromDb(db, "2026-10-05");
  assert.equal(current, 325920);
  assert.equal(prior, 325920, "Sep 30 statement is not the Oct 5 close");
});

test("a sync gap is a stale baseline, and the same accounts sit on both sides", () => {
  const db = createTestDb();
  db.prepare(
    `INSERT INTO institution_connections (id, type, display_name, status) VALUES ('c1', 'schwab', 'S', 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO institution_connections (id, type, display_name, status) VALUES ('conn_manual', 'manual', 'Manual', 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO accounts (id, connection_id, name, account_bucket, type) VALUES ('schwab_a', 'c1', 'Taxable', 'brokerage', 'brokerage')`,
  ).run();
  db.prepare(
    `INSERT INTO accounts (id, connection_id, name, account_bucket, type) VALUES ('schwab_51115831', 'c1', 'Disconnected', 'brokerage', 'brokerage')`,
  ).run();
  db.prepare(
    `INSERT INTO accounts (id, connection_id, name, account_bucket, type) VALUES ('${RORIE_ACCOUNT_ID}', 'c1', 'Rorie', 'brokerage', 'brokerage')`,
  ).run();
  db.prepare(
    `INSERT INTO accounts (id, connection_id, name, account_bucket, type) VALUES ('manual_529', 'conn_manual', '529', '529', 'manual')`,
  ).run();
  db.prepare(`INSERT INTO securities (id, symbol, name, security_type) VALUES ('sec_529', '529FUND', '529 Fund', 'fund')`).run();
  db.prepare(
    `INSERT INTO account_value_points (account_id, as_of, equity_value, cash_value, source) VALUES ('schwab_a', '2026-09-30T16:56:00.000Z', 4770000, 0, 'schwab_balances')`,
  ).run();
  db.prepare(
    `INSERT INTO account_value_points (account_id, as_of, equity_value, cash_value, prior_equity_value, source) VALUES ('schwab_a', '2026-10-06T13:21:00.000Z', 5340000, 0, NULL, 'schwab_balances')`,
  ).run();
  db.prepare(
    `INSERT INTO account_value_points (account_id, as_of, equity_value, cash_value, source) VALUES ('schwab_51115831', '2026-05-08T16:00:00.000Z', 200000, 0, 'schwab_balances')`,
  ).run();
  db.prepare(
    `INSERT INTO account_value_points (account_id, as_of, equity_value, cash_value, source) VALUES ('${RORIE_ACCOUNT_ID}', '2026-10-06T13:21:00.000Z', 9000000, 0, 'schwab_balances')`,
  ).run();
  db.prepare(
    `INSERT INTO holding_snapshots (id, account_id, as_of) VALUES ('snap529', 'manual_529', '2026-10-06T13:21:00.000Z')`,
  ).run();
  db.prepare(
    `INSERT INTO positions (id, snapshot_id, security_id, quantity, price, market_value) VALUES ('p529', 'snap529', 'sec_529', 1, 325920, 325920)`,
  ).run();

  const schwab = resolveStoredSchwabBaseline(db, "2026-10-06", "2026-10-05");
  const external = externalMarketValueFromDb(db, "2026-10-05");
  assert.equal(schwab.status, "stale");
  if (schwab.status !== "stale") return;
  assert.equal(schwab.staleBaselineYmd, "2026-09-30");
  assert.equal(schwab.current, 5_540_000);
  assert.equal(schwab.prior, 4_970_000);
  assert.equal(external.current, 325920);
  assert.equal(external.prior, 325920);
  assert.equal(schwab.current + external.current, 5_865_920);
  assert.equal(schwab.prior + external.prior, 5_295_920);
});

test("a prior-session print is the day baseline even when an older print and a live prior disagree", () => {
  const db = createTestDb();
  db.prepare(
    `INSERT INTO institution_connections (id, type, display_name, status) VALUES ('c1', 'schwab', 'S', 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO accounts (id, connection_id, name, account_bucket, type) VALUES ('schwab_a', 'c1', 'Taxable', 'brokerage', 'brokerage')`,
  ).run();
  db.prepare(
    `INSERT INTO account_value_points (account_id, as_of, equity_value, cash_value, source) VALUES ('schwab_a', '2026-09-30T16:56:00.000Z', 4770000, 0, 'schwab_balances')`,
  ).run();
  db.prepare(
    `INSERT INTO account_value_points (account_id, as_of, equity_value, cash_value, source) VALUES ('schwab_a', '2026-10-05T20:00:00.000Z', 5160000, 0, 'schwab_balances')`,
  ).run();
  db.prepare(
    `INSERT INTO account_value_points (account_id, as_of, equity_value, cash_value, source) VALUES ('schwab_a', '2026-10-06T13:21:00.000Z', 5340000, 0, 'schwab_balances')`,
  ).run();

  const baseline = resolveStoredSchwabBaseline(db, "2026-10-06", "2026-10-05", "main", {
    byAccount: new Map([["schwab_a", { current: 5_340_000, prior: 4_000_000 }]]),
    current: 5_340_000,
    prior: 4_000_000,
  });
  assert.equal(baseline.status, "prior_session");
  assert.equal("staleBaselineYmd" in baseline, false);
  assert.equal(baseline.current, 5_340_000);
  assert.equal(baseline.prior, 5_160_000);
});

test("Schwab prior-day equity is the day baseline when the prior session was not stored", () => {
  const db = createTestDb();
  db.prepare(
    `INSERT INTO institution_connections (id, type, display_name, status) VALUES ('c1', 'schwab', 'S', 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO accounts (id, connection_id, name, account_bucket, type) VALUES ('schwab_a', 'c1', 'Taxable', 'brokerage', 'brokerage')`,
  ).run();
  db.prepare(
    `INSERT INTO account_value_points (account_id, as_of, equity_value, cash_value, prior_equity_value, source) VALUES ('schwab_a', '2026-10-06T13:21:00.000Z', 5340000, 0, 5160000, 'schwab_balances')`,
  ).run();

  const baseline = resolveStoredSchwabBaseline(db, "2026-10-06", "2026-10-05");
  assert.equal(baseline.status, "prior_session");
  assert.equal(baseline.current, 5_340_000);
  assert.equal(baseline.prior, 5_160_000);
});

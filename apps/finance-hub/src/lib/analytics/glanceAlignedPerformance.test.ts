import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";

import {
  carryForwardExternalAccountDailyTotals,
  getGlanceAlignedPortfolioValueSeriesByBucket,
  mergeGlanceAlignedDailyTotals,
  nextUsWeekdayOnOrAfterIso,
  resolvePerformanceTrackingBaselineYmd,
} from "@/lib/analytics/glanceAlignedPerformance";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  const schemaPath = path.join(process.cwd(), "src", "db", "schema.sql");
  db.exec(fs.readFileSync(schemaPath, "utf-8"));
  return db;
}

test("mergeGlanceAlignedDailyTotals sums Schwab liquidation and external MV per day", () => {
  const merged = mergeGlanceAlignedDailyTotals(
    [{ asOf: "2026-05-22T15:00:00Z", totalMarketValue: 5_000_000 }],
    [{ asOf: "2026-05-22T16:00:00Z", totalMarketValue: 250_000 }],
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0]!.totalMarketValue, 5_250_000);
});

test("nextUsWeekdayOnOrAfterIso maps weekend as_of onto Monday", () => {
  assert.equal(nextUsWeekdayOnOrAfterIso("2026-05-22"), "2026-05-22");
  assert.equal(nextUsWeekdayOnOrAfterIso("2026-05-23T18:00:00Z"), "2026-05-25");
  assert.equal(nextUsWeekdayOnOrAfterIso("2026-05-24"), "2026-05-25");
});

test("carryForwardExternalAccountDailyTotals sums two manuals on the same weekday", () => {
  const series = carryForwardExternalAccountDailyTotals([
    { accountId: "manual_529", asOf: "2026-05-22T10:00:00Z", totalMarketValue: 80_000 },
    { accountId: "manual_taxable", asOf: "2026-05-22T15:00:00Z", totalMarketValue: 40_000 },
  ]);
  assert.equal(series.length, 1);
  assert.equal(series[0]!.totalMarketValue, 120_000);
  assert.equal(series[0]!.asOf.slice(0, 10), "2026-05-22");
});

test("carryForwardExternalAccountDailyTotals keeps first account after a later account is added", () => {
  const series = carryForwardExternalAccountDailyTotals([
    { accountId: "manual_529", asOf: "2026-05-01T10:00:00Z", totalMarketValue: 80_000 },
    { accountId: "manual_taxable", asOf: "2026-05-20T15:00:00Z", totalMarketValue: 40_000 },
  ]);
  assert.equal(series.length, 2);
  assert.equal(series[0]!.asOf.slice(0, 10), "2026-05-01");
  assert.equal(series[0]!.totalMarketValue, 80_000);
  assert.equal(series[1]!.asOf.slice(0, 10), "2026-05-20");
  assert.equal(series[1]!.totalMarketValue, 120_000);
});

test("carryForwardExternalAccountDailyTotals does not double-count two snapshots of the same account", () => {
  const series = carryForwardExternalAccountDailyTotals([
    { accountId: "manual_529", asOf: "2026-05-22T10:00:00Z", totalMarketValue: 80_000 },
    { accountId: "manual_529", asOf: "2026-05-22T16:00:00Z", totalMarketValue: 82_000 },
  ]);
  assert.equal(series.length, 1);
  assert.equal(series[0]!.totalMarketValue, 82_000);
});

test("carryForwardExternalAccountDailyTotals maps a Saturday edit onto Monday", () => {
  const series = carryForwardExternalAccountDailyTotals([
    { accountId: "manual_529", asOf: "2026-05-23T18:00:00Z", totalMarketValue: 80_000 },
  ]);
  assert.equal(series.length, 1);
  assert.equal(series[0]!.asOf.slice(0, 10), "2026-05-25");
  assert.equal(series[0]!.totalMarketValue, 80_000);
});

test("getGlanceAlignedPortfolioValueSeriesByBucket sums 529 and later manual brokerage", () => {
  const db = createTestDb();
  db.prepare(
    `INSERT INTO institution_connections (id, type, display_name, status) VALUES ('conn_manual', 'manual', 'Manual', 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO institution_connections (id, type, display_name, status) VALUES ('c1', 'schwab', 'S', 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO accounts (id, connection_id, name, account_bucket, type) VALUES ('manual_529', 'conn_manual', '529', '529', 'manual')`,
  ).run();
  db.prepare(
    `INSERT INTO accounts (id, connection_id, name, account_bucket, type) VALUES ('manual_broker', 'conn_manual', 'Taxable', 'brokerage', 'manual')`,
  ).run();
  db.prepare(
    `INSERT INTO accounts (id, connection_id, name, account_bucket, type) VALUES ('schwab_a', 'c1', 'Schwab', 'brokerage', 'brokerage')`,
  ).run();
  db.prepare(
    `INSERT INTO holding_snapshots (id, account_id, as_of) VALUES ('snap529', 'manual_529', '2026-05-01T10:00:00Z')`,
  ).run();
  db.prepare(
    `INSERT INTO holding_snapshots (id, account_id, as_of) VALUES ('snapbrok', 'manual_broker', '2026-05-20T15:00:00Z')`,
  ).run();
  db.prepare(`INSERT INTO securities (id, symbol, name, security_type) VALUES ('sec_529', 'VTHRX', '529 Fund', 'fund')`).run();
  db.prepare(`INSERT INTO securities (id, symbol, name, security_type) VALUES ('sec_vti', 'VTI', 'VTI', 'fund')`).run();
  db.prepare(
    `INSERT INTO positions (id, snapshot_id, security_id, quantity, price, market_value) VALUES ('p529', 'snap529', 'sec_529', 1, 80000, 80000)`,
  ).run();
  db.prepare(
    `INSERT INTO positions (id, snapshot_id, security_id, quantity, price, market_value) VALUES ('pbrok', 'snapbrok', 'sec_vti', 1, 40000, 40000)`,
  ).run();
  db.prepare(
    `INSERT INTO account_value_points (account_id, as_of, equity_value, cash_value, source) VALUES ('schwab_a', '2026-05-20T10:00:00Z', 1000000, 0, 'schwab_balances')`,
  ).run();

  const series = getGlanceAlignedPortfolioValueSeriesByBucket("combined", db);
  const may20 = series.filter((p) => p.asOf.slice(0, 10) === "2026-05-20");
  assert.equal(may20.length, 1);
  assert.equal(may20[0]!.totalMarketValue, 1_120_000);
});

test("resolvePerformanceTrackingBaselineYmd uses lookback when enough history exists", () => {
  const series = [
    { asOf: "2026-05-05T12:00:00Z", totalMarketValue: 1 },
    { asOf: "2026-05-06T12:00:00Z", totalMarketValue: 2 },
    { asOf: "2026-05-22T12:00:00Z", totalMarketValue: 3 },
  ];
  const out = resolvePerformanceTrackingBaselineYmd(series, new Date("2026-05-22T18:00:00-04:00"));
  assert.equal(out.baselineYmd, "2026-05-05");
  assert.equal(out.resetForward, false);
});

test("resolvePerformanceTrackingBaselineYmd resets forward when history is too thin", () => {
  const series = [{ asOf: "2026-05-22T12:00:00Z", totalMarketValue: 1 }];
  const out = resolvePerformanceTrackingBaselineYmd(series, new Date("2026-05-22T18:00:00-04:00"));
  assert.equal(out.baselineYmd, "2026-05-22");
  assert.equal(out.resetForward, true);
});

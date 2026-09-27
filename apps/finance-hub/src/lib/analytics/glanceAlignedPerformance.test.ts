import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";

import {
  carryForwardExternalAccountDailyTotals,
  getGlanceAlignedPortfolioValueSeriesByBucket,
  mergeGlanceAlignedDailyTotals,
  mergeMissingSnapshotDays,
  nextUsWeekdayOnOrAfterIso,
  resolvePerformanceTrackingBaselineYmd,
} from "@/lib/analytics/glanceAlignedPerformance";

test("mergeMissingSnapshotDays fills days that liquidation series skipped", () => {
  const merged = mergeMissingSnapshotDays(
    [
      { asOf: "2026-06-23T20:00:00.000Z", totalMarketValue: 100 },
      { asOf: "2026-07-10T20:00:00.000Z", totalMarketValue: 120 },
    ],
    [
      { snapshot_date: "2026-06-23", total_value: 99 },
      { snapshot_date: "2026-07-03", total_value: 110 },
    ],
  );
  assert.equal(merged.length, 3);
  assert.equal(merged[1]!.asOf.startsWith("2026-07-03"), true);
  assert.equal(merged[1]!.totalMarketValue, 110);
});

test("mergeGlanceAlignedDailyTotals sums Schwab liquidation and external MV per day", () => {
  const merged = mergeGlanceAlignedDailyTotals(
    [{ asOf: "2026-05-22T15:00:00Z", totalMarketValue: 5_000_000 }],
    [{ asOf: "2026-05-22T16:00:00Z", totalMarketValue: 250_000 }],
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0]!.totalMarketValue, 5_250_000);
});

test("mergeGlanceAlignedDailyTotals carries a 529 onto later Schwab days and does not backfill", () => {
  const merged = mergeGlanceAlignedDailyTotals(
    [
      { asOf: "2026-05-01T16:00:00Z", totalMarketValue: 1_000_000 },
      { asOf: "2026-05-04T16:00:00Z", totalMarketValue: 1_010_000 },
    ],
    [{ asOf: "2026-05-04T12:00:00Z", totalMarketValue: 80_000 }],
  );
  const may1 = merged.find((p) => p.asOf.slice(0, 10) === "2026-05-01");
  const may4 = merged.find((p) => p.asOf.slice(0, 10) === "2026-05-04");
  assert.equal(may1!.totalMarketValue, 1_000_000);
  assert.equal(may4!.totalMarketValue, 1_090_000);
});

test("carryForwardExternalAccountDailyTotals keeps the first manual account after a later one is added", () => {
  const series = carryForwardExternalAccountDailyTotals([
    { accountId: "manual_529", asOf: "2026-05-01T10:00:00Z", totalMarketValue: 80_000 },
    { accountId: "manual_taxable", asOf: "2026-05-20T15:00:00Z", totalMarketValue: 40_000 },
  ]);
  assert.equal(series.length, 2);
  assert.equal(series[1]!.totalMarketValue, 120_000);
});

test("nextUsWeekdayOnOrAfterIso maps a Saturday edit onto Monday", () => {
  assert.equal(nextUsWeekdayOnOrAfterIso("2026-05-23T18:00:00Z"), "2026-05-25");
});

test("glance-aligned history includes manual cash and does not double-count Schwab sweep", () => {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(path.join(process.cwd(), "src", "db", "schema.sql"), "utf-8"));
  db.prepare(
    `INSERT INTO institution_connections (id, type, display_name, status) VALUES ('conn_manual', 'manual', 'Manual', 'active')`,
  ).run();
  db.prepare(`INSERT INTO institution_connections (id, type, display_name, status) VALUES ('c1', 'schwab', 'S', 'active')`).run();
  db.prepare(
    `INSERT INTO accounts (id, connection_id, name, account_bucket, type) VALUES ('manual_hysa', 'conn_manual', 'HYSA', 'brokerage', 'manual')`,
  ).run();
  db.prepare(
    `INSERT INTO accounts (id, connection_id, name, account_bucket, type) VALUES ('schwab_a', 'c1', 'Schwab', 'brokerage', 'brokerage')`,
  ).run();
  db.prepare(`INSERT INTO holding_snapshots (id, account_id, as_of) VALUES ('snapCash', 'manual_hysa', '2026-05-22T12:00:00Z')`).run();
  db.prepare(`INSERT INTO holding_snapshots (id, account_id, as_of) VALUES ('snapSweep', 'schwab_a', '2026-05-22T12:00:00Z')`).run();
  db.prepare(`INSERT INTO securities (id, symbol, name, security_type) VALUES ('sec_cash', 'CASH', 'Cash', 'cash')`).run();
  db.prepare(
    `INSERT INTO positions (id, snapshot_id, security_id, quantity, price, market_value) VALUES ('pCash', 'snapCash', 'sec_cash', 50000, 1, 50000)`,
  ).run();
  db.prepare(
    `INSERT INTO positions (id, snapshot_id, security_id, quantity, price, market_value) VALUES ('pSweep', 'snapSweep', 'sec_cash', 80000, 1, 80000)`,
  ).run();
  db.prepare(
    `INSERT INTO account_value_points (account_id, as_of, equity_value, cash_value, source) VALUES ('schwab_a', '2026-05-22T16:00:00Z', 1000000, 80000, 'schwab_balances')`,
  ).run();

  const series = getGlanceAlignedPortfolioValueSeriesByBucket("combined", db);
  assert.equal(series.length, 1);
  assert.equal(series[0]!.totalMarketValue, 1_050_000);
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

test("resolvePerformanceTrackingBaselineYmd does not cap all-history at the recency window", () => {
  const series = [
    { asOf: "2026-01-05T12:00:00Z", totalMarketValue: 1 },
    { asOf: "2026-01-06T12:00:00Z", totalMarketValue: 2 },
    { asOf: "2026-05-21T12:00:00Z", totalMarketValue: 3 },
    { asOf: "2026-05-22T12:00:00Z", totalMarketValue: 4 },
  ];
  const out = resolvePerformanceTrackingBaselineYmd(series, new Date("2026-05-22T18:00:00-04:00"));
  assert.equal(out.baselineYmd, "2026-01-05");
  assert.equal(out.resetForward, false);
});

test("resolvePerformanceTrackingBaselineYmd resets forward when history is too thin", () => {
  const series = [{ asOf: "2026-05-22T12:00:00Z", totalMarketValue: 1 }];
  const out = resolvePerformanceTrackingBaselineYmd(series, new Date("2026-05-22T18:00:00-04:00"));
  assert.equal(out.baselineYmd, "2026-05-22");
  assert.equal(out.resetForward, true);
});

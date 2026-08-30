import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";

import {
  getGlanceAlignedPortfolioValueSeriesByBucket,
  mergeGlanceAlignedDailyTotals,
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

test("glance-aligned series includes manual cash (matches terminal glance)", () => {
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
    `INSERT INTO accounts (id, connection_id, name, account_bucket, type) VALUES ('manual_hysa', 'conn_manual', 'HYSA', 'brokerage', 'manual')`,
  ).run();
  db.prepare(
    `INSERT INTO account_value_points (account_id, as_of, equity_value, cash_value, source)
     VALUES ('schwab_a', '2026-05-22T15:00:00Z', 1000000, 80000, 'schwab_balances')`,
  ).run();
  db.prepare(
    `INSERT INTO holding_snapshots (id, account_id, as_of) VALUES ('snap_cash', 'manual_hysa', '2026-05-22T16:00:00Z')`,
  ).run();
  db.prepare(
    `INSERT INTO securities (id, symbol, name, security_type) VALUES ('sec_CASH', 'CASH', 'Cash', 'cash')`,
  ).run();
  db.prepare(
    `INSERT INTO positions (id, snapshot_id, security_id, quantity, price, market_value)
     VALUES ('p_cash', 'snap_cash', 'sec_CASH', 50000, 1, 50000)`,
  ).run();
  // Schwab sweep cash must not be double-counted on top of liquidation.
  db.prepare(
    `INSERT INTO holding_snapshots (id, account_id, as_of) VALUES ('snap_schwab', 'schwab_a', '2026-05-22T15:00:00Z')`,
  ).run();
  db.prepare(
    `INSERT INTO positions (id, snapshot_id, security_id, quantity, price, market_value)
     VALUES ('p_schwab_cash', 'snap_schwab', 'sec_CASH', 80000, 1, 80000)`,
  ).run();

  const series = getGlanceAlignedPortfolioValueSeriesByBucket("combined", db);
  assert.equal(series.length, 1);
  assert.equal(series[0]!.totalMarketValue, 1_050_000);
});

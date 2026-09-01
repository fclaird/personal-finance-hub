import type Database from "better-sqlite3";

import { bucketFromAccount } from "@/lib/accountBuckets";
import type { PortfolioValuePoint } from "@/lib/analytics/performance";
import { getDb } from "@/lib/db";
import type { FlavorId } from "@/lib/flavor";
import { allSyncedAccountsWhereSql } from "@/lib/holdings/latestSnapshots";
import { POSITION_MARKET_VALUE_SQL } from "@/lib/holdings/positionMarketValue";
import { glanceSessionYmd } from "@/lib/market/glanceSession";
import { collapseToTradingDays, portfolioAsOfIsoDate } from "@/lib/portfolio/snapshots";

/** Recency check only: if fewer than two trading days exist in this window, tracking resets to today. Not a history cap. */
export const PERFORMANCE_TRACKING_RECENCY_DAYS = 19;
/** @deprecated Use PERFORMANCE_TRACKING_RECENCY_DAYS */
export const PERFORMANCE_BACKFILL_LOOKBACK_DAYS = PERFORMANCE_TRACKING_RECENCY_DAYS;

type PerformanceBucket = "combined" | "retirement" | "brokerage";

function accountInBucket(
  bucket: PerformanceBucket,
  accountName: string,
  accountNickname: string | null,
  accountBucket: string | null,
): boolean {
  if (bucket === "combined") return true;
  return bucketFromAccount(accountName, accountNickname, accountBucket) === bucket;
}

function schwabLiquidationPoints(
  db: Database.Database,
  bucket: PerformanceBucket,
  flavor: FlavorId = "main",
): PortfolioValuePoint[] {
  const rows = db
    .prepare(
      `
      SELECT av.as_of AS as_of, av.equity_value AS mv,
             a.name AS account_name, a.nickname AS account_nickname, a.account_bucket AS account_bucket
      FROM account_value_points av
      JOIN accounts a ON a.id = av.account_id
      WHERE a.id LIKE 'schwab_%' AND ${allSyncedAccountsWhereSql(flavor, "a")}
      ORDER BY av.as_of ASC
    `,
    )
    .all() as Array<{
    as_of: string;
    mv: number;
    account_name: string;
    account_nickname: string | null;
    account_bucket: string | null;
  }>;

  const byAsOf = new Map<string, number>();
  for (const row of rows) {
    if (!accountInBucket(bucket, row.account_name, row.account_nickname, row.account_bucket)) continue;
    if (!Number.isFinite(row.mv)) continue;
    byAsOf.set(row.as_of, (byAsOf.get(row.as_of) ?? 0) + row.mv);
  }

  return [...byAsOf.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([asOf, totalMarketValue]) => ({ asOf, totalMarketValue }));
}

function externalMarketValuePoints(
  db: Database.Database,
  bucket: PerformanceBucket,
  flavor: FlavorId = "main",
): PortfolioValuePoint[] {
  const rows = db
    .prepare(
      `
      SELECT hs.as_of AS as_of, SUM(${POSITION_MARKET_VALUE_SQL}) AS mv,
             a.name AS account_name, a.nickname AS account_nickname, a.account_bucket AS account_bucket
      FROM holding_snapshots hs
      JOIN accounts a ON a.id = hs.account_id
      JOIN positions p ON p.snapshot_id = hs.id
      JOIN securities s ON s.id = p.security_id
      WHERE a.id NOT LIKE 'schwab_%'
        AND ${allSyncedAccountsWhereSql(flavor, "a")}
        AND s.security_type != 'cash'
      GROUP BY hs.as_of, a.id
      ORDER BY hs.as_of ASC
    `,
    )
    .all() as Array<{
    as_of: string;
    mv: number;
    account_name: string;
    account_nickname: string | null;
    account_bucket: string | null;
  }>;

  const byAsOf = new Map<string, number>();
  for (const row of rows) {
    if (!accountInBucket(bucket, row.account_name, row.account_nickname, row.account_bucket)) continue;
    if (!Number.isFinite(row.mv)) continue;
    byAsOf.set(row.as_of, (byAsOf.get(row.as_of) ?? 0) + row.mv);
  }

  return [...byAsOf.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([asOf, totalMarketValue]) => ({ asOf, totalMarketValue }));
}

/** Merge Schwab liquidation and external holdings into one daily total (quick-glance semantics). */
export function mergeGlanceAlignedDailyTotals(
  schwab: PortfolioValuePoint[],
  external: PortfolioValuePoint[],
): PortfolioValuePoint[] {
  const byDay = new Map<string, { asOf: string; schwab: number; external: number }>();

  for (const point of schwab) {
    const day = portfolioAsOfIsoDate(point.asOf);
    const row = byDay.get(day) ?? { asOf: point.asOf, schwab: 0, external: 0 };
    if (point.asOf.localeCompare(row.asOf) >= 0) {
      row.asOf = point.asOf;
      row.schwab = point.totalMarketValue;
    }
    byDay.set(day, row);
  }

  for (const point of external) {
    const day = portfolioAsOfIsoDate(point.asOf);
    const row = byDay.get(day) ?? { asOf: point.asOf, schwab: 0, external: 0 };
    if (point.asOf.localeCompare(row.asOf) >= 0) {
      row.asOf = point.asOf;
      row.external = point.totalMarketValue;
    }
    byDay.set(day, row);
  }

  return [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, row]) => ({ asOf: row.asOf, totalMarketValue: row.schwab + row.external }))
    .filter((point) => point.totalMarketValue > 0);
}

export function getGlanceAlignedPortfolioValueSeriesByBucket(
  bucket: PerformanceBucket,
  db: Database.Database = getDb(),
  flavor: FlavorId = "main",
): PortfolioValuePoint[] {
  const schwab = collapseToTradingDays(schwabLiquidationPoints(db, bucket, flavor));
  const external = collapseToTradingDays(externalMarketValuePoints(db, bucket, flavor));
  return mergeGlanceAlignedDailyTotals(schwab, external);
}

/** Fill trading days that have a weekly snapshot but no liquidation/external point. */
export function mergeMissingSnapshotDays(
  series: PortfolioValuePoint[],
  snapshots: Array<{ snapshot_date: string; total_value: number }>,
): PortfolioValuePoint[] {
  const existing = new Set(series.map((p) => portfolioAsOfIsoDate(p.asOf)));
  const extra: PortfolioValuePoint[] = [];
  for (const snap of snapshots) {
    const day = snap.snapshot_date.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    if (existing.has(day)) continue;
    if (!Number.isFinite(snap.total_value) || snap.total_value <= 0) continue;
    extra.push({ asOf: `${day}T20:00:00.000Z`, totalMarketValue: snap.total_value });
    existing.add(day);
  }
  if (extra.length === 0) return series;
  return [...series, ...extra].sort((a, b) => a.asOf.localeCompare(b.asOf));
}

function lookbackCutoffYmd(now: Date, days: number): string {
  const d = new Date(now);
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export function resolvePerformanceTrackingBaselineYmd(
  series: PortfolioValuePoint[],
  now: Date = new Date(),
  lookbackDays: number = PERFORMANCE_TRACKING_RECENCY_DAYS,
): { baselineYmd: string; resetForward: boolean } {
  const forced = process.env.PERFORMANCE_TRACKING_BASELINE_YMD?.trim();
  if (forced && /^\d{4}-\d{2}-\d{2}$/.test(forced)) {
    return { baselineYmd: forced, resetForward: true };
  }

  const today = glanceSessionYmd(now);
  const cutoffYmd = lookbackCutoffYmd(now, lookbackDays);
  const inWindow = collapseToTradingDays(series.filter((p) => portfolioAsOfIsoDate(p.asOf) >= cutoffYmd));

  if (inWindow.length >= 2 && series.length >= 2) {
    return { baselineYmd: portfolioAsOfIsoDate(series[0]!.asOf), resetForward: false };
  }

  return { baselineYmd: today, resetForward: true };
}

export function filterSeriesFromBaseline(
  series: PortfolioValuePoint[],
  baselineYmd: string,
): PortfolioValuePoint[] {
  return series.filter((p) => portfolioAsOfIsoDate(p.asOf) >= baselineYmd);
}

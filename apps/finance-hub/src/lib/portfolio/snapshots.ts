import type Database from "better-sqlite3";

import type { PortfolioValuePoint } from "@/lib/analytics/performance";
import { getPortfolioValueSeriesByBucket } from "@/lib/analytics/performance";
import type { DataMode } from "@/lib/dataMode";
import { newId } from "@/lib/id";
import type { PerformanceHistoryTimeframe } from "@/lib/portfolio/performanceWindow";

export type PortfolioSnapshotBucket = "combined" | "retirement" | "brokerage";

const BUCKETS: PortfolioSnapshotBucket[] = ["combined", "retirement", "brokerage"];

/** SPY/QQQ daily close on or before `isoDate` (YYYY-MM-DD), provider schwab. */
export function closeOnOrBefore(db: Database.Database, symbol: string, isoDate: string): number | null {
  const row = db
    .prepare(
      `
      SELECT close FROM price_points
      WHERE provider = 'schwab' AND symbol = ? AND date <= ?
      ORDER BY date DESC
      LIMIT 1
    `,
    )
    .get(symbol, isoDate) as { close: number } | undefined;
  const c = row?.close;
  return typeof c === "number" && Number.isFinite(c) && c > 0 ? c : null;
}

function utcNoon(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m, d, 12, 0, 0));
}

function isoFromUtcDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** All Fridays from first Friday on/after start through end (inclusive), UTC calendar. */
export function fridayAnchorsBetween(startIso: string, endIso: string): string[] {
  const start = utcNoon(
    Number(startIso.slice(0, 4)),
    Number(startIso.slice(5, 7)) - 1,
    Number(startIso.slice(8, 10)),
  );
  const end = utcNoon(
    Number(endIso.slice(0, 4)),
    Number(endIso.slice(5, 7)) - 1,
    Number(endIso.slice(8, 10)),
  );
  const out: string[] = [];
  let d = new Date(start);
  const dow = d.getUTCDay();
  const toFri = (5 - dow + 7) % 7;
  d = new Date(d.getTime() + toFri * 86400000);
  while (d.getTime() <= end.getTime()) {
    out.push(isoFromUtcDate(d));
    d = new Date(d.getTime() + 7 * 86400000);
  }
  return out;
}

/** For anchors strictly before cutoffIso, keep the latest Friday per calendar month. */
export function thinMonthlyBefore(anchors: string[], cutoffIso: string): string[] {
  const young = anchors.filter((a) => a >= cutoffIso);
  const old = anchors.filter((a) => a < cutoffIso);
  const byMonth = new Map<string, string>();
  for (const a of old) {
    const ym = a.slice(0, 7);
    const prev = byMonth.get(ym);
    if (!prev || a > prev) byMonth.set(ym, a);
  }
  const oldThinned = [...byMonth.values()].sort();
  return [...oldThinned, ...young].sort();
}

export function portfolioAsOfIsoDate(iso: string): string {
  return iso.slice(0, 10);
}

/** Last series point with day <= anchorDay (carry-forward). */
export function lastPointOnOrBefore(series: PortfolioValuePoint[], anchorDay: string): PortfolioValuePoint | null {
  let best: PortfolioValuePoint | null = null;
  for (const p of series) {
    const d = portfolioAsOfIsoDate(p.asOf);
    if (d <= anchorDay) best = p;
  }
  return best;
}

const MONTHLY_THIN_YEARS = 3;

export function backfillPortfolioSnapshotsFromSeries(
  db: Database.Database,
  mode: DataMode,
  source: string,
): number {
  const today = isoFromUtcDate(utcNoon(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
  const thinCutoff = isoFromUtcDate(
    new Date(Date.now() - MONTHLY_THIN_YEARS * 365.25 * 86400000),
  );

  const upsert = db.prepare(
    `
    INSERT INTO portfolio_snapshots (
      id, snapshot_date, bucket, total_value, account_balances_json, spy_close, qqq_close, source, created_at
    ) VALUES (
      @id, @snapshot_date, @bucket, @total_value, @account_balances_json, @spy_close, @qqq_close, @source, @created_at
    )
    ON CONFLICT(snapshot_date, bucket) DO UPDATE SET
      total_value = excluded.total_value,
      account_balances_json = excluded.account_balances_json,
      spy_close = excluded.spy_close,
      qqq_close = excluded.qqq_close,
      source = excluded.source,
      created_at = excluded.created_at
  `,
  );

  let n = 0;
  const now = new Date().toISOString();

  for (const bucket of BUCKETS) {
    const series = getPortfolioValueSeriesByBucket(bucket, mode);
    if (series.length === 0) continue;

    const minDay = portfolioAsOfIsoDate(series[0]!.asOf);
    let anchors = fridayAnchorsBetween(minDay, today);
    anchors = thinMonthlyBefore(anchors, thinCutoff);

    for (const anchor of anchors) {
      const pt = lastPointOnOrBefore(series, anchor);
      if (!pt || pt.totalMarketValue <= 0) continue;

      const spy = closeOnOrBefore(db, "SPY", anchor);
      const qqq = closeOnOrBefore(db, "QQQ", anchor);

      upsert.run({
        id: newId("psnap"),
        snapshot_date: anchor,
        bucket,
        total_value: pt.totalMarketValue,
        account_balances_json: null,
        spy_close: spy,
        qqq_close: qqq,
        source,
        created_at: now,
      });
      n++;
    }
  }

  return n;
}

/** Most recent Friday (UTC); if today is Friday, returns today. */
export function lastFridayIsoUtc(): string {
  const now = new Date();
  const d = utcNoon(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const day = d.getUTCDay();
  const offset = (day + 7 - 5) % 7;
  d.setUTCDate(d.getUTCDate() - offset);
  return isoFromUtcDate(d);
}

/**
 * Record week-ending snapshot using latest portfolio totals (per bucket) and benchmark closes on `snapshotDate`
 * (default: last Friday UTC).
 */
export function upsertWeekEndingPortfolioSnapshots(
  db: Database.Database,
  mode: DataMode,
  source: string,
  snapshotDate?: string,
): number {
  const anchor = snapshotDate ?? lastFridayIsoUtc();
  const upsert = db.prepare(
    `
    INSERT INTO portfolio_snapshots (
      id, snapshot_date, bucket, total_value, account_balances_json, spy_close, qqq_close, source, created_at
    ) VALUES (
      @id, @snapshot_date, @bucket, @total_value, @account_balances_json, @spy_close, @qqq_close, @source, @created_at
    )
    ON CONFLICT(snapshot_date, bucket) DO UPDATE SET
      total_value = excluded.total_value,
      account_balances_json = excluded.account_balances_json,
      spy_close = excluded.spy_close,
      qqq_close = excluded.qqq_close,
      source = excluded.source,
      created_at = excluded.created_at
  `,
  );

  const spy = closeOnOrBefore(db, "SPY", anchor);
  const qqq = closeOnOrBefore(db, "QQQ", anchor);
  const now = new Date().toISOString();
  let n = 0;

  for (const bucket of BUCKETS) {
    const series = getPortfolioValueSeriesByBucket(bucket, mode);
    if (series.length === 0) continue;
    const last = series[series.length - 1]!;
    if (!Number.isFinite(last.totalMarketValue) || last.totalMarketValue <= 0) continue;

    upsert.run({
      id: newId("psnap"),
      snapshot_date: anchor,
      bucket,
      total_value: last.totalMarketValue,
      account_balances_json: null,
      spy_close: spy,
      qqq_close: qqq,
      source,
      created_at: now,
    });
    n++;
  }

  return n;
}

export type { PerformanceHistoryTimeframe } from "@/lib/portfolio/performanceWindow";
export { timeframeToCutoffIso, timeframeToWindowRangeMs } from "@/lib/portfolio/performanceWindow";

function utcNoonMsFromIsoDate(iso: string): number {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7)) - 1;
  const d = Number(iso.slice(8, 10));
  return Date.UTC(y, m, d, 12, 0, 0);
}

function xMsFromPortfolioAsOf(asOf: string): number {
  const parsed = Date.parse(asOf);
  if (Number.isFinite(parsed)) return parsed;
  return utcNoonMsFromIsoDate(portfolioAsOfIsoDate(asOf));
}

export type PerformanceHistoryChartRow = {
  date: string;
  x_ms: number;
  portfolio: number;
  spy: number | null;
  qqq: number | null;
  raw_portfolio_value: number;
  spy_close: number | null;
  qqq_close: number | null;
};

type BenchRow = { date: string; close: number };

function baselineCloseOnOrBefore(bench: BenchRow[], isoDate: string): number | null {
  let lo = 0;
  let hi = bench.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bench[mid]!.date <= isoDate) {
      idx = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (idx < 0) return null;
  const c = bench[idx]!.close;
  return Number.isFinite(c) && c > 0 ? c : null;
}

function benchPctSeries(bench: BenchRow[], isoDate: string, baseline: number | null): number | null {
  if (baseline == null) return null;
  const close = baselineCloseOnOrBefore(bench, isoDate);
  if (close == null) return null;
  return ((close / baseline) - 1) * 100;
}

/** Build indexed % series from weekly snapshot rows (normalize first point in window to 0% change / index 100 base for stats). */
export function chartDataFromSnapshotRows(
  rows: Array<{ snapshot_date: string; total_value: number; spy_close: number | null; qqq_close: number | null }>,
): PerformanceHistoryChartRow[] {
  if (rows.length === 0) return [];

  const startPv = rows[0]!.total_value;
  const startSpy = rows[0]!.spy_close;
  const startQq = rows[0]!.qqq_close;

  return rows.map((r) => ({
    date: r.snapshot_date,
    x_ms: utcNoonMsFromIsoDate(r.snapshot_date),
    portfolio: startPv > 0 ? ((r.total_value / startPv) - 1) * 100 : 0,
    spy:
      startSpy != null && startSpy > 0 && r.spy_close != null && r.spy_close > 0
        ? ((r.spy_close / startSpy) - 1) * 100
        : null,
    qqq:
      startQq != null && startQq > 0 && r.qqq_close != null && r.qqq_close > 0
        ? ((r.qqq_close / startQq) - 1) * 100
        : null,
    raw_portfolio_value: r.total_value,
    spy_close: r.spy_close,
    qqq_close: r.qqq_close,
  }));
}

/** Fallback: dense holdings/account series + benchmark arrays (same semantics as Performance page). */
export function chartDataFromDenseSeries(
  series: PortfolioValuePoint[],
  benchSpy: BenchRow[],
  benchQq: BenchRow[],
): PerformanceHistoryChartRow[] {
  if (series.length === 0) return [];

  const startIso = portfolioAsOfIsoDate(series[0]!.asOf);
  const startPv = series[0]!.totalMarketValue || 1;
  const baselineSpy = baselineCloseOnOrBefore(benchSpy, startIso);
  const baselineQq = baselineCloseOnOrBefore(benchQq, startIso);

  return series.map((p) => {
    const iso = portfolioAsOfIsoDate(p.asOf);
    return {
      date: iso,
      x_ms: xMsFromPortfolioAsOf(p.asOf),
      portfolio: ((p.totalMarketValue / startPv) - 1) * 100,
      spy: benchPctSeries(benchSpy, iso, baselineSpy),
      qqq: benchPctSeries(benchQq, iso, baselineQq),
      raw_portfolio_value: p.totalMarketValue,
      spy_close: baselineCloseOnOrBefore(benchSpy, iso),
      qqq_close: baselineCloseOnOrBefore(benchQq, iso),
    };
  });
}

/** Sort by time and add a final point at `nowMs` (carry-forward portfolio; SPY/QQQ through latest close). */
export function extendChartDataThroughNow(
  rows: PerformanceHistoryChartRow[],
  benchSpy: BenchRow[],
  benchQq: BenchRow[],
  nowMs: number,
): PerformanceHistoryChartRow[] {
  if (rows.length === 0) return rows;
  const sorted = [...rows].sort((a, b) => a.x_ms - b.x_ms);
  const last = sorted[sorted.length - 1]!;
  if (nowMs - last.x_ms < 60 * 60 * 1000) return sorted;

  const firstDate = sorted[0]!.date;
  const baselineSpy = baselineCloseOnOrBefore(benchSpy, firstDate);
  const baselineQq = baselineCloseOnOrBefore(benchQq, firstDate);
  const todayIso = new Date(nowMs).toISOString().slice(0, 10);
  const spyClose = baselineCloseOnOrBefore(benchSpy, todayIso);
  const qqqClose = baselineCloseOnOrBefore(benchQq, todayIso);

  const startPv = sorted[0]!.raw_portfolio_value;
  const lastPv = last.raw_portfolio_value;

  return [
    ...sorted,
    {
      date: todayIso,
      x_ms: nowMs,
      portfolio: startPv > 0 ? ((lastPv / startPv) - 1) * 100 : last.portfolio,
      spy:
        baselineSpy != null && spyClose != null && baselineSpy > 0
          ? ((spyClose / baselineSpy) - 1) * 100
          : null,
      qqq:
        baselineQq != null && qqqClose != null && baselineQq > 0
          ? ((qqqClose / baselineQq) - 1) * 100
          : null,
      raw_portfolio_value: lastPv,
      spy_close: spyClose,
      qqq_close: qqqClose,
    },
  ];
}

export function shouldUseSnapshotFallback(snapshotCountInWindow: number, tf: PerformanceHistoryTimeframe): boolean {
  if (snapshotCountInWindow < 2) return true;
  if ((tf === "1W" || tf === "1M") && snapshotCountInWindow < 3) return true;
  return false;
}

export function getCachedBenchmarkSeriesLocal(db: Database.Database, symbol: string): BenchRow[] {
  return db
    .prepare(
      `
      SELECT date, close FROM price_points
      WHERE provider = 'schwab' AND symbol = ?
      ORDER BY date ASC
    `,
    )
    .all(symbol) as BenchRow[];
}

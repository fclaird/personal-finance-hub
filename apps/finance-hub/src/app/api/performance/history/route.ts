import { NextResponse } from "next/server";

import { getGlanceAlignedPortfolioValueSeriesByBucket, resolvePerformanceTrackingBaselineYmd, filterSeriesFromBaseline, mergeMissingSnapshotDays, PERFORMANCE_BACKFILL_LOOKBACK_DAYS } from "@/lib/analytics/glanceAlignedPerformance";
import { resolveViewScope } from "@/lib/viewScope";
import { getDb } from "@/lib/db";
import { logError } from "@/lib/log";
import { countBenchmarkPriceRows, ensureBenchmarkHistory, ensureYahooBenchmarkHistory } from "@/lib/market/benchmarks";
import { PERFORMANCE_BENCHMARKS, type ExtraPerformanceBenchmarkId } from "@/lib/market/performanceBenchmarks";
import { yahooChartSymbol } from "@/lib/market/yahooChartFetch";
import {
  chartDataFromDenseSeries,
  chartDataFromSnapshotRows,
  collapseToTradingDays,
  extendChartDataThroughNow,
  getCachedBenchmarkSeriesLocal,
  portfolioAsOfIsoDate,
  shouldUseSnapshotFallback,
  withExtraBenchmarkSeries,
} from "@/lib/portfolio/snapshots";
import {
  timeframeToCutoffIso,
  timeframeToWindowRangeMs,
  type PerformanceHistoryTimeframe,
} from "@/lib/portfolio/performanceWindow";

const VALID_TF: PerformanceHistoryTimeframe[] = ["ALL", "1D", "1W", "1M", "3M", "6M", "1Y", "3Y", "5Y"];
const VALID_BUCKET = new Set(["combined", "retirement", "brokerage"]);

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const tf = (url.searchParams.get("timeframe") ?? "ALL") as PerformanceHistoryTimeframe;
    if (!VALID_TF.includes(tf)) {
      return NextResponse.json({ ok: false, error: "Invalid timeframe" }, { status: 400 });
    }

    const bucket = url.searchParams.get("bucket") ?? "combined";
    if (!VALID_BUCKET.has(bucket)) {
      return NextResponse.json({ ok: false, error: "Invalid bucket" }, { status: 400 });
    }

    const { flavor, dataMode: mode } = await resolveViewScope();

    if (tf === "1D") {
      return NextResponse.json({
        ok: true,
        timeframe: tf,
        bucket,
        mode,
        meta: { useToday: true, source_mix: "live" as const },
        chart_data: [],
        total_return_pct: null,
        vs_spy: null,
        vs_qqq: null,
      });
    }

    const nowMs = Date.now();
    const cutoff = timeframeToCutoffIso(tf, nowMs);
    const db = getDb();
    const todayIso = new Date(nowMs).toISOString().slice(0, 10);

    const denseAll = mergeMissingSnapshotDays(
      getGlanceAlignedPortfolioValueSeriesByBucket(bucket as "combined" | "retirement" | "brokerage", db, flavor),
      (
        db
          .prepare(
            `SELECT snapshot_date, total_value FROM portfolio_snapshots WHERE bucket = ? ORDER BY snapshot_date ASC`,
          )
          .all(bucket) as Array<{ snapshot_date: string; total_value: number }>
      ),
    );
    const tradingDaySeriesAll = collapseToTradingDays(denseAll);
    const { baselineYmd, resetForward } = resolvePerformanceTrackingBaselineYmd(tradingDaySeriesAll, new Date(nowMs));
    const tradingDaySeries = filterSeriesFromBaseline(tradingDaySeriesAll, baselineYmd);
    const denseInWindow = cutoff
      ? tradingDaySeries.filter((p) => portfolioAsOfIsoDate(p.asOf) >= cutoff)
      : tradingDaySeries;
    const seriesForChart = denseInWindow.length >= 2 ? denseInWindow : tradingDaySeries;
    const throughDate =
      seriesForChart.length > 0
        ? portfolioAsOfIsoDate(seriesForChart[seriesForChart.length - 1]!.asOf)
        : todayIso;
    const needThrough = throughDate > todayIso ? throughDate : todayIso;

    await ensureBenchmarkHistory("SPY", needThrough);
    await ensureBenchmarkHistory("QQQ", needThrough);

    const extraBenchmarks = PERFORMANCE_BENCHMARKS.filter(
      (b): b is (typeof PERFORMANCE_BENCHMARKS)[number] & { id: ExtraPerformanceBenchmarkId } =>
        b.id !== "spy" && b.id !== "qqq",
    );
    for (const b of extraBenchmarks) {
      try {
        if (b.provider === "schwab") await ensureBenchmarkHistory(b.symbol, needThrough);
        else await ensureYahooBenchmarkHistory(b.symbol, needThrough);
      } catch (e) {
        logError(`performance_benchmark_${b.id}`, e);
      }
    }

    const snapRows = (
      cutoff
        ? db.prepare(
            `
        SELECT snapshot_date, total_value, spy_close, qqq_close
        FROM portfolio_snapshots
        WHERE bucket = ? AND snapshot_date >= ?
        ORDER BY snapshot_date ASC
      `,
          )
        : db.prepare(
            `
        SELECT snapshot_date, total_value, spy_close, qqq_close
        FROM portfolio_snapshots
        WHERE bucket = ?
        ORDER BY snapshot_date ASC
      `,
          )
    ).all(...(cutoff ? [bucket, cutoff] : [bucket])) as Array<{
      snapshot_date: string;
      total_value: number;
      spy_close: number | null;
      qqq_close: number | null;
    }>;

    const benchSpy = getCachedBenchmarkSeriesLocal(db, "SPY");
    const benchQq = getCachedBenchmarkSeriesLocal(db, "QQQ");
    const extraSeries = extraBenchmarks.map((b) => ({
      id: b.id,
      series: getCachedBenchmarkSeriesLocal(
        db,
        b.provider === "yahoo" ? yahooChartSymbol(b.symbol) : b.symbol,
        b.provider,
      ),
    }));
    const spyRows = countBenchmarkPriceRows("SPY");
    const qqqRows = countBenchmarkPriceRows("QQQ");

    let source_mix: "glance_aligned" | "snapshots" | "fallback";
    let chart_data;

    if (seriesForChart.length === 0) {
      return NextResponse.json({
        ok: true,
        timeframe: tf,
        bucket,
        mode,
        meta: {
          source_mix: "fallback" as const,
          note: "no_portfolio_points_in_window",
          tracking_start: baselineYmd,
          tracking_reset_forward: resetForward,
          portfolio_source: "schwab_liquidation_plus_external",
          lookback_days: PERFORMANCE_BACKFILL_LOOKBACK_DAYS,
          window_start_ms: nowMs,
          window_end_ms: nowMs,
          benchmark_spy_rows: spyRows,
          benchmark_qqq_rows: qqqRows,
        },
        chart_data: [],
        total_return_pct: null,
        vs_spy: null,
        vs_qqq: null,
      });
    }

    const dataStartMs = Date.parse(seriesForChart[0]!.asOf);
    const { startMs: windowStartMs, endMs: windowEndMs } = timeframeToWindowRangeMs(
      tf,
      nowMs,
      Number.isFinite(dataStartMs) ? dataStartMs : null,
    );

    if (seriesForChart.length >= 2) {
      chart_data = chartDataFromDenseSeries(seriesForChart, benchSpy, benchQq);
      source_mix = "glance_aligned";
    } else if (snapRows.length >= 2 && !shouldUseSnapshotFallback(snapRows.length, tf === "ALL" ? "6M" : tf)) {
      chart_data = chartDataFromSnapshotRows(snapRows);
      source_mix = "snapshots";
    } else if (seriesForChart.length >= 1) {
      chart_data = chartDataFromDenseSeries(seriesForChart, benchSpy, benchQq);
      source_mix = "glance_aligned";
    } else {
      chart_data = chartDataFromSnapshotRows(snapRows);
      source_mix = "snapshots";
    }

    if (chart_data.length > 0) {
      chart_data = extendChartDataThroughNow(chart_data, benchSpy, benchQq, nowMs);
      chart_data = withExtraBenchmarkSeries(chart_data, extraSeries);
      chart_data = chart_data.map((row, idx) => ({ ...row, seq_index: idx }));
    }

    if (chart_data.length === 0) {
      return NextResponse.json({
        ok: true,
        timeframe: tf,
        bucket,
        mode,
        meta: {
          source_mix,
          note: "empty_chart",
          tracking_start: baselineYmd,
          tracking_reset_forward: resetForward,
          portfolio_source: "schwab_liquidation_plus_external",
          lookback_days: PERFORMANCE_BACKFILL_LOOKBACK_DAYS,
          window_start_ms: windowStartMs,
          window_end_ms: windowEndMs,
          benchmark_spy_rows: spyRows,
          benchmark_qqq_rows: qqqRows,
        },
        chart_data: [],
        total_return_pct: null,
        vs_spy: null,
        vs_qqq: null,
      });
    }

    const last = chart_data[chart_data.length - 1]!;
    const total_return_pct = Math.round(last.portfolio * 100) / 100;
    const vs_spy = last.spy != null ? Math.round((last.portfolio - last.spy) * 100) / 100 : null;
    const vs_qqq = last.qqq != null ? Math.round((last.portfolio - last.qqq) * 100) / 100 : null;

    return NextResponse.json({
      ok: true,
      timeframe: tf,
      bucket,
      mode,
        meta: {
          source_mix,
          tracking_start: seriesForChart[0] ? portfolioAsOfIsoDate(seriesForChart[0].asOf) : baselineYmd,
          tracking_reset_forward: resetForward,
          portfolio_source: "schwab_liquidation_plus_external",
          lookback_days: PERFORMANCE_BACKFILL_LOOKBACK_DAYS,
          window_start_ms: windowStartMs,
          window_end_ms: windowEndMs,
          benchmark_spy_rows: spyRows,
          benchmark_qqq_rows: qqqRows,
        },
      chart_data,
      total_return_pct,
      vs_spy,
      vs_qqq,
    });
  } catch (e) {
    logError("performance_history_get_failed", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

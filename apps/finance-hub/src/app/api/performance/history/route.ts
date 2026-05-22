import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getPortfolioValueSeriesByBucket } from "@/lib/analytics/performance";
import { DATA_MODE_COOKIE, parseDataMode } from "@/lib/dataMode";
import { getDb } from "@/lib/db";
import { logError } from "@/lib/log";
import { countBenchmarkPriceRows, ensureBenchmarkHistory } from "@/lib/market/benchmarks";
import {
  chartDataFromDenseSeries,
  chartDataFromSnapshotRows,
  extendChartDataThroughNow,
  getCachedBenchmarkSeriesLocal,
  portfolioAsOfIsoDate,
  shouldUseSnapshotFallback,
} from "@/lib/portfolio/snapshots";
import {
  timeframeToCutoffIso,
  timeframeToWindowRangeMs,
  type PerformanceHistoryTimeframe,
} from "@/lib/portfolio/performanceWindow";

const VALID_TF: PerformanceHistoryTimeframe[] = ["1D", "1W", "1M", "3M", "6M", "1Y", "3Y", "5Y"];
const VALID_BUCKET = new Set(["combined", "retirement", "brokerage"]);

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const tf = (url.searchParams.get("timeframe") ?? "6M") as PerformanceHistoryTimeframe;
    if (!VALID_TF.includes(tf)) {
      return NextResponse.json({ ok: false, error: "Invalid timeframe" }, { status: 400 });
    }

    const bucket = url.searchParams.get("bucket") ?? "combined";
    if (!VALID_BUCKET.has(bucket)) {
      return NextResponse.json({ ok: false, error: "Invalid bucket" }, { status: 400 });
    }

    const jar = await cookies();
    const mode = parseDataMode(jar.get(DATA_MODE_COOKIE)?.value);

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

    await ensureBenchmarkHistory("SPY");
    await ensureBenchmarkHistory("QQQ");

    const nowMs = Date.now();
    const { startMs: windowStartMs, endMs: windowEndMs } = timeframeToWindowRangeMs(tf, nowMs);
    const cutoff = timeframeToCutoffIso(tf, nowMs);
    const db = getDb();

    const snapRows = db
      .prepare(
        `
        SELECT snapshot_date, total_value, spy_close, qqq_close
        FROM portfolio_snapshots
        WHERE bucket = ? AND snapshot_date >= ?
        ORDER BY snapshot_date ASC
      `,
      )
      .all(bucket, cutoff) as Array<{
      snapshot_date: string;
      total_value: number;
      spy_close: number | null;
      qqq_close: number | null;
    }>;

    const benchSpy = getCachedBenchmarkSeriesLocal(db, "SPY");
    const benchQq = getCachedBenchmarkSeriesLocal(db, "QQQ");
    const spyRows = countBenchmarkPriceRows("SPY");
    const qqqRows = countBenchmarkPriceRows("QQQ");

    const dense = getPortfolioValueSeriesByBucket(bucket as "combined" | "retirement" | "brokerage", mode);
    const denseInWindow = dense.filter((p) => portfolioAsOfIsoDate(p.asOf) >= cutoff);

    let source_mix: "snapshots" | "fallback";
    let chart_data;

    if (denseInWindow.length === 0) {
      return NextResponse.json({
        ok: true,
        timeframe: tf,
        bucket,
        mode,
        meta: {
          source_mix: "fallback" as const,
          note: "no_portfolio_points_in_window",
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

    if (shouldUseSnapshotFallback(snapRows.length, tf)) {
      chart_data = chartDataFromDenseSeries(denseInWindow, benchSpy, benchQq);
      source_mix = "fallback";
    } else {
      chart_data = chartDataFromSnapshotRows(snapRows);
      source_mix = "snapshots";
    }

    if (chart_data.length > 0) {
      chart_data = extendChartDataThroughNow(chart_data, benchSpy, benchQq, nowMs);
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

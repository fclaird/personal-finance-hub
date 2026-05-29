import { logError } from "@/lib/log";
import type { GlanceSeriesPoint, TimedClosePoint } from "@/lib/market/glanceExtendedHours";
import {
  extractYahooTimedCloses,
  glanceChartContext,
  nyBarPhase,
  resolveGlanceSplitContext,
  splitTimedPointsForGlance,
} from "@/lib/market/glanceExtendedHours";
import { filterExtendedRawForGrid, filterTimedPointsForGlanceSession } from "@/lib/market/glanceTimedFilters";
import { filterSeriesToSessionYmd, isoDateInUsEastern, schwabIntradayWindowForGlance } from "@/lib/market/glanceSession";
import { fetchYahooIntradayChart } from "@/lib/market/yahooChartFetch";
import { ensureCandles, getCachedCandles } from "@/lib/terminal/ohlcv";

const REFERENCE_SYMBOL = "SPY";

export type GlanceTimedGrid = {
  sessionYmd: string;
  regular: TimedClosePoint[];
  extended: TimedClosePoint[];
  rthCloseTsMs: number | null;
};

export function priceAtOrBefore(bars: TimedClosePoint[], tsMs: number, fallback: number): number {
  if (bars.length === 0) return fallback;
  let lo = 0;
  let hi = bars.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid]!.tsMs <= tsMs) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best >= 0 ? bars[best]!.close : fallback;
}

export function resampleTimedPointsToGrid(source: TimedClosePoint[], grid: TimedClosePoint[]): TimedClosePoint[] {
  if (grid.length === 0) return [];
  const fallback = source.length > 0 ? source[source.length - 1]!.close : grid[0]!.close;
  return grid.map((g) => ({
    tsMs: g.tsMs,
    close: priceAtOrBefore(source, g.tsMs, fallback),
  }));
}

export function toGlanceSeries(points: TimedClosePoint[]): GlanceSeriesPoint[] {
  return points.map((p, idx) => ({ idx, close: p.close, tsMs: p.tsMs }));
}

export function buildAlignedExtendedSeries(
  regular: GlanceSeriesPoint[],
  resampledExtended: TimedClosePoint[],
  sessionClose: number,
): GlanceSeriesPoint[] {
  if (resampledExtended.length === 0 || regular.length === 0) return [];
  const startIdx = regular.length - 1;
  const anchorTs = regular[startIdx]!.tsMs ?? resampledExtended[0]!.tsMs;
  const out: GlanceSeriesPoint[] = [{ idx: startIdx, close: sessionClose, tsMs: anchorTs }];
  for (let i = 0; i < resampledExtended.length; i++) {
    const pt = resampledExtended[i]!;
    if (pt.tsMs <= anchorTs) continue;
    out.push({ idx: startIdx + out.length, close: pt.close, tsMs: pt.tsMs });
  }
  return out.length >= 2 ? out : [];
}

function schwabSinceMs(window: "1D" | "5D"): number {
  return Date.now() - (window === "5D" ? 8 : 2) * 24 * 60 * 60 * 1000;
}

async function spyTimedPointsFromSchwab(sessionYmd: string, window: "1D" | "5D"): Promise<TimedClosePoint[]> {
  await ensureCandles(REFERENCE_SYMBOL, "5m", window);
  const candles = getCachedCandles(REFERENCE_SYMBOL, "5m", schwabSinceMs(window));
  return filterSeriesToSessionYmd(candles, sessionYmd).map((c) => ({ tsMs: c.tsMs, close: c.close }));
}

/** Shared SPY session grid so portfolio and benchmark tiles share the same horizontal time scale. */
export async function fetchCanonicalGlanceGrid(sessionYmd: string, now: Date = new Date()): Promise<GlanceTimedGrid> {
  const ctx = glanceChartContext(now);
  const schwabWindow = schwabIntradayWindowForGlance(now);
  let timed: TimedClosePoint[] = [];

  const yahoo = await fetchYahooIntradayChart(REFERENCE_SYMBOL, "5d", { includePrePost: true });
  if (yahoo?.result) {
    const allTimed = extractYahooTimedCloses(yahoo.result);
    timed = filterTimedPointsForGlanceSession(allTimed, sessionYmd, ctx);
  }
  if (timed.length < 2) {
    try {
      timed = await spyTimedPointsFromSchwab(sessionYmd, schwabWindow);
    } catch (e) {
      logError("glance_grid_schwab_fallback", e);
    }
  }

  const splitCtx = resolveGlanceSplitContext(ctx, timed, now);
  const split = splitTimedPointsForGlance(timed, splitCtx);
  const regular = split.regular.map((p) => ({ tsMs: p.tsMs ?? 0, close: p.close })).filter((p) => p.tsMs > 0);
  const extPhase = splitCtx.extendedPhase ?? (split.extended.length > 0 ? "post" : null);
  const extendedRaw = filterExtendedRawForGrid(
    split.extended.map((p) => ({ tsMs: p.tsMs ?? 0, close: p.close })),
    regular,
    extPhase,
  );

  return {
    sessionYmd,
    regular,
    extended: extendedRaw,
    rthCloseTsMs: regular.length > 0 ? regular[regular.length - 1]!.tsMs : null,
  };
}

export function extendedPhaseForGrid(grid: GlanceTimedGrid, sessionYmd?: string): "post" | "pre" | null {
  if (grid.extended.length === 0) return null;
  const ymd = sessionYmd ?? grid.sessionYmd;
  for (const p of grid.extended) {
    if (nyBarPhase(p.tsMs, ymd) === "post") return "post";
  }
  for (const p of grid.extended) {
    if (nyBarPhase(p.tsMs, ymd) === "pre") return "pre";
  }
  const sample = grid.extended[0]!;
  const sampleYmd = isoDateInUsEastern(sample.tsMs);
  return nyBarPhase(sample.tsMs, sampleYmd) === "pre" ? "pre" : "post";
}

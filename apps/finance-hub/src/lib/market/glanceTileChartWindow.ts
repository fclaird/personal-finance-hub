import { nyBarPhase } from "@/lib/market/glanceExtendedHours";
import { nyWallTimeMs } from "@/lib/market/futuresGlanceSession";
import { nyYmd } from "@/lib/market/usEquitySession";

import type { GlanceChartPoint, UsMarketGlanceItem } from "@/app/components/terminal/MarketGlanceCard";

/** Pre-market reference window start (08:30 ET). */
export const GLANCE_PREMARKET_REF_START_MIN = 8 * 60 + 30;
/** Last hour of regular session (15:00 ET). */
export const GLANCE_RTH_LAST_HOUR_START_MIN = 15 * 60;
/** RTH session close bell (16:00 ET). */
export const GLANCE_RTH_CLOSE_MIN = 16 * 60;
/** Fixed intraday x-axis span (wall clock) for US equity glance charts. */
export const GLANCE_TILE_CHART_AXIS_HOURS = 14;
const MS_PER_HOUR = 60 * 60 * 1000;

export type GlanceTileChartWindow = {
  fromMs: number;
  omitPriorAnchor: true;
};

export type GlanceTileChartWindowCtx = {
  marketOpen: boolean;
  sessionYmd?: string;
  /** Wall clock for trim/axis decisions (defaults to Date.now()). */
  nowMs?: number;
};

function ctxNowMs(ctx: GlanceTileChartWindowCtx): number {
  return ctx.nowMs ?? Date.now();
}

export type GlanceTileChartItemRef = Pick<
  UsMarketGlanceItem,
  "futuresKind" | "instrumentKind" | "extendedPhase" | "extendedSeries"
>;

/** 08:30 pre-market hour before the 09:30 open, or 15:00 last RTH hour before the 16:00 close. */
export function resolveGlanceTrimAnchorMs(
  ctx: GlanceTileChartWindowCtx,
  item?: GlanceTileChartItemRef,
): number | null {
  const sessionYmd = (ctx.sessionYmd ?? nyYmd(new Date(ctxNowMs(ctx)))).trim();
  if (!sessionYmd) return null;

  if (item && !isUsEquityGlanceItem(item)) return null;

  const preStart = nyWallTimeMs(sessionYmd, GLANCE_PREMARKET_REF_START_MIN);
  const lastHourStart = nyWallTimeMs(sessionYmd, GLANCE_RTH_LAST_HOUR_START_MIN);
  const nowMs = ctxNowMs(ctx);

  if (!ctx.marketOpen && item?.extendedPhase === "pre") {
    return preStart;
  }

  if (ctx.marketOpen) {
    return nowMs >= lastHourStart ? lastHourStart : preStart;
  }

  return lastHourStart;
}

function isUsEquityGlanceItem(item: Pick<UsMarketGlanceItem, "futuresKind" | "instrumentKind">): boolean {
  return item.futuresKind == null && item.instrumentKind !== "cash_index";
}

export { isUsEquityGlanceItem };

function extendedSeriesHasPreMarket(
  series: GlanceChartPoint[] | undefined,
  sessionYmd: string,
): boolean {
  if (!series?.length) return false;
  for (const p of series) {
    if (p.tsMs != null && Number.isFinite(p.tsMs) && nyBarPhase(p.tsMs, sessionYmd) === "pre") {
      return true;
    }
  }
  return false;
}

/** Which intraday slice to show on US equity quick-glance sparklines. */
export function resolveGlanceTileChartWindow(
  item: Pick<UsMarketGlanceItem, "futuresKind" | "instrumentKind" | "extendedPhase" | "extendedSeries">,
  ctx: GlanceTileChartWindowCtx,
): GlanceTileChartWindow | null {
  if (!isUsEquityGlanceItem(item)) return null;

  const sessionYmd = (ctx.sessionYmd ?? nyYmd(new Date(ctxNowMs(ctx)))).trim();
  if (!sessionYmd) return null;

  const fromMs = resolveGlanceTrimAnchorMs(ctx, item);
  if (fromMs == null) return null;

  return {
    fromMs,
    omitPriorAnchor: true,
  };
}

function filterGlanceSeriesPoints(points: GlanceChartPoint[], fromMs: number): GlanceChartPoint[] {
  const timed = points.filter((p) => p.tsMs != null && Number.isFinite(p.tsMs));
  if (timed.length === 0) return points;

  const kept = timed.filter((p) => p.tsMs! >= fromMs);
  if (kept.length >= 2) return reindexGlancePoints(kept);

  const before = timed.filter((p) => p.tsMs! < fromMs);
  const lastBefore = before[before.length - 1];
  if (lastBefore && kept.length === 1) return reindexGlancePoints([lastBefore, kept[0]!]);
  if (lastBefore && kept.length === 0) {
    const next = timed.find((p) => p.tsMs! >= fromMs);
    if (next) return reindexGlancePoints([lastBefore, next]);
    return reindexGlancePoints([lastBefore]);
  }
  if (kept.length === 1) return reindexGlancePoints(kept);

  return points;
}

function reindexGlancePoints(points: GlanceChartPoint[]): GlanceChartPoint[] {
  return points.map((p, idx) => ({ ...p, idx }));
}

/** Trim series to the active reference window (pre-market hour or RTH last hour). */
export function applyGlanceTileChartWindow(
  item: UsMarketGlanceItem,
  window: GlanceTileChartWindow,
): UsMarketGlanceItem {
  return {
    ...item,
    series: filterGlanceSeriesPoints(item.series, window.fromMs),
    extendedSeries:
      item.extendedSeries != null
        ? filterGlanceSeriesPoints(item.extendedSeries, window.fromMs)
        : item.extendedSeries,
  };
}

export function glanceItemForTileChart(
  item: UsMarketGlanceItem,
  ctx: GlanceTileChartWindowCtx,
): { item: UsMarketGlanceItem; omitPriorAnchor: boolean } {
  const window = resolveGlanceTileChartWindow(item, ctx);
  if (!window) return { item, omitPriorAnchor: false };
  return {
    item: applyGlanceTileChartWindow(item, window),
    omitPriorAnchor: window.omitPriorAnchor,
  };
}

function resolveGlanceTrimFromMs(
  ctx: GlanceTileChartWindowCtx,
  item?: GlanceTileChartItemRef | GlanceTileChartItemRef[],
): number | null {
  const sessionYmd = (ctx.sessionYmd ?? nyYmd(new Date(ctxNowMs(ctx)))).trim();
  if (!sessionYmd) return null;

  const items = item == null ? [] : Array.isArray(item) ? item : [item];
  let trimFromMs: number | null = null;
  for (const entry of items) {
    if (!isUsEquityGlanceItem(entry)) continue;
    const anchor = resolveGlanceTrimAnchorMs(ctx, entry);
    if (anchor == null) continue;
    trimFromMs = trimFromMs == null ? anchor : Math.min(trimFromMs, anchor);
  }
  if (trimFromMs != null) return trimFromMs;

  return resolveGlanceTrimAnchorMs(ctx);
}

/** Full fixed span from trim anchor (14 wall-clock hours). */
export function glanceTileChartAxisEndMs(trimFromMs: number): number {
  return trimFromMs + GLANCE_TILE_CHART_AXIS_HOURS * MS_PER_HOUR;
}

/** Latest timestamp on a glance chart row series (ignores null/invalid values). */
export function lastGlanceChartDataTsMs(rows: Array<{ tsMs?: number | null }>): number | null {
  for (let i = rows.length - 1; i >= 0; i--) {
    const ts = rows[i]?.tsMs;
    if (ts != null && Number.isFinite(ts)) return ts;
  }
  return null;
}

/**
 * Fixed 14-hour wall-clock x-axis anchored at the trim point (08:30 open hour, 15:00 from the last RTH hour / after the close).
 * The domain always spans the full 14 hours so intraday data plots left-to-right on a consistent scale (as on quick-glance tiles).
 * Once data would extend past the right edge, later ticks clip (`allowDataOverflow`) while the scale stays fixed.
 */
export function resolveGlanceTileChartAxisDomain(
  ctx: GlanceTileChartWindowCtx,
  item?: GlanceTileChartItemRef | GlanceTileChartItemRef[],
  _lastDataTsMs?: number | null,
): { startMs: number; endMs: number } | null {
  const items = item == null ? [] : Array.isArray(item) ? item : [item];
  if (items.length === 1 && !isUsEquityGlanceItem(items[0]!)) return null;
  if (items.length > 1 && items.every((entry) => !isUsEquityGlanceItem(entry))) return null;

  const trimFromMs = resolveGlanceTrimFromMs(ctx, item);
  if (trimFromMs == null) return null;

  return { startMs: trimFromMs, endMs: glanceTileChartAxisEndMs(trimFromMs) };
}

/** Gray extended-hours band bounds on the fixed time axis. */
export function resolveGlanceExtendedShadeX(
  ctx: GlanceTileChartWindowCtx,
  axis: { startMs: number; endMs: number },
  lastDataTsMs: number | null,
): { fromMs: number; toMs: number } | null {
  const sessionYmd = (ctx.sessionYmd ?? nyYmd(new Date())).trim();
  if (!sessionYmd) return null;

  const lastX = lastDataTsMs != null && Number.isFinite(lastDataTsMs) ? lastDataTsMs : axis.endMs;

  if (!ctx.marketOpen) {
    return {
      fromMs: nyWallTimeMs(sessionYmd, GLANCE_RTH_CLOSE_MIN),
      toMs: Math.max(nyWallTimeMs(sessionYmd, GLANCE_RTH_CLOSE_MIN), lastX),
    };
  }

  const openMs = nyWallTimeMs(sessionYmd, 9 * 60 + 30);
  if (axis.startMs >= openMs) return null;
  return { fromMs: axis.startMs, toMs: Math.min(openMs, axis.endMs) };
}

/** Show gray extended segment during RTH when pre-market bars are on the chart. */
export function glanceShowExtendedChartSegment(
  item: Pick<
    UsMarketGlanceItem,
    "extendedSeries" | "extendedPhase" | "futuresKind" | "instrumentKind" | "tradableOpen"
  >,
  options: { sessionOpen: boolean; sessionYmd?: string },
): boolean {
  const hasExtended = (item.extendedSeries?.length ?? 0) >= 2;
  if (!hasExtended) return false;

  if (item.futuresKind != null || item.instrumentKind === "cash_index") {
    return !(options.sessionOpen && item.futuresKind == null && item.instrumentKind !== "cash_index");
  }

  if (
    options.sessionOpen &&
    extendedSeriesHasPreMarket(item.extendedSeries, options.sessionYmd ?? nyYmd(new Date()))
  ) {
    return true;
  }

  return !options.sessionOpen;
}

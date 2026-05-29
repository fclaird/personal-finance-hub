import { usEquityExtendedHoursPhase } from "@/lib/market/glanceExtendedHours";
import { nyWallTimeMs } from "@/lib/market/futuresGlanceSession";
import { nyYmd } from "@/lib/market/usEquitySession";

import type { GlanceChartPoint, UsMarketGlanceItem } from "@/app/components/terminal/MarketGlanceCard";

/** Pre-market reference window start (08:30 ET). */
export const GLANCE_PREMARKET_REF_START_MIN = 8 * 60 + 30;
/** Pre-market data start (04:00 ET). */
export const GLANCE_PREMARKET_START_MIN = 4 * 60;
/** RTH session open (09:30 ET). */
export const GLANCE_RTH_OPEN_MIN = 9 * 60 + 30;
/** Last hour of regular session (15:00 ET). */
export const GLANCE_RTH_LAST_HOUR_START_MIN = 15 * 60;
/** RTH session close bell (16:00 ET). */
export const GLANCE_RTH_CLOSE_MIN = 16 * 60;
/** After-hours end (20:00 ET). */
export const GLANCE_POST_MARKET_END_MIN = 20 * 60;
/** Legacy fixed span; prefer mode-specific axis end below. */
export const GLANCE_TILE_CHART_AXIS_HOURS = 14;
const MS_PER_HOUR = 60 * 60 * 1000;

export type GlanceTileChartWindow = {
  fromMs: number;
  omitPriorAnchor: true;
};

export type GlanceChartWindowMode =
  | "rth_live"
  | "overnight_bridge"
  | "post_close"
  | "closed_session";

export type GlanceTileChartWindowCtx = {
  marketOpen: boolean;
  sessionYmd?: string;
  /** Calendar day for live pre/extended segments (defaults to today at nowMs). */
  chartYmd?: string;
  /** When true, chart shows the prior session (not today's pre-market window). */
  showingPriorSession?: boolean;
  /** Wall clock for trim/axis decisions (defaults to Date.now()). */
  nowMs?: number;
};

function ctxNowMs(ctx: GlanceTileChartWindowCtx): number {
  return ctx.nowMs ?? Date.now();
}

function ctxChartYmd(ctx: GlanceTileChartWindowCtx): string {
  return (ctx.chartYmd ?? nyYmd(new Date(ctxNowMs(ctx)))).trim();
}

export type GlanceTileChartItemRef = Pick<
  UsMarketGlanceItem,
  "futuresKind" | "instrumentKind" | "extendedPhase" | "extendedSeries"
>;

function itemExtendedPhase(
  ctx: GlanceTileChartWindowCtx,
  item?: GlanceTileChartItemRef | GlanceTileChartItemRef[],
): "pre" | "post" | null {
  const items = item == null ? [] : Array.isArray(item) ? item : [item];
  for (const entry of items) {
    if (!isUsEquityGlanceItem(entry)) continue;
    if (entry.extendedPhase === "pre" || entry.extendedPhase === "post") return entry.extendedPhase;
  }
  return null;
}

/** Which glance chart time window is active for US equity tiles/overlays. */
export function resolveGlanceChartWindowMode(
  ctx: GlanceTileChartWindowCtx,
  item?: GlanceTileChartItemRef | GlanceTileChartItemRef[],
): GlanceChartWindowMode {
  if (ctx.marketOpen) return "rth_live";

  const extPhase = itemExtendedPhase(ctx, item);
  if (ctx.showingPriorSession && extPhase === "pre") return "overnight_bridge";
  if (extPhase === "post") return "post_close";
  return "closed_session";
}

/** 09:30 RTH open during live session, 08:30 pre-market hour before open when closed, or 15:00 last RTH hour after the close. */
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
  const todayYmd = nyYmd(new Date(nowMs));
  const mode = resolveGlanceChartWindowMode(ctx, item);

  if (mode === "rth_live") {
    return nyWallTimeMs(sessionYmd, GLANCE_RTH_OPEN_MIN);
  }

  if (mode === "overnight_bridge") {
    return lastHourStart;
  }

  const livePreMarket =
    !ctx.showingPriorSession &&
    sessionYmd === todayYmd &&
    usEquityExtendedHoursPhase(new Date(nowMs)) === "pre";

  if (livePreMarket && item?.extendedPhase === "pre") {
    return preStart;
  }

  return lastHourStart;
}

function isUsEquityGlanceItem(item: Pick<UsMarketGlanceItem, "futuresKind" | "instrumentKind">): boolean {
  return item.futuresKind == null && item.instrumentKind !== "cash_index";
}

export { isUsEquityGlanceItem };

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

/** Mode-specific x-axis end for US equity glance charts. */
export function resolveGlanceTileChartAxisEndMs(
  ctx: GlanceTileChartWindowCtx,
  trimFromMs: number,
  item?: GlanceTileChartItemRef | GlanceTileChartItemRef[],
  lastDataTsMs?: number | null,
): number {
  const sessionYmd = (ctx.sessionYmd ?? nyYmd(new Date(ctxNowMs(ctx)))).trim();
  const chartYmd = ctxChartYmd(ctx);
  const nowMs = ctxNowMs(ctx);
  const mode = resolveGlanceChartWindowMode(ctx, item);

  if (mode === "rth_live") {
    return nyWallTimeMs(sessionYmd, GLANCE_RTH_CLOSE_MIN);
  }

  if (mode === "overnight_bridge") {
    const openMs = nyWallTimeMs(chartYmd, GLANCE_RTH_OPEN_MIN);
    const nominalEnd = Math.max(trimFromMs, openMs);
    if (lastDataTsMs != null && Number.isFinite(lastDataTsMs) && lastDataTsMs > trimFromMs) {
      return Math.max(trimFromMs, Math.min(lastDataTsMs, nominalEnd));
    }
    return nominalEnd;
  }

  if (mode === "post_close") {
    const nominalEnd = nyWallTimeMs(sessionYmd, GLANCE_POST_MARKET_END_MIN);
    if (lastDataTsMs != null && Number.isFinite(lastDataTsMs) && lastDataTsMs > trimFromMs) {
      return Math.max(trimFromMs, Math.min(lastDataTsMs, nominalEnd));
    }
    return nominalEnd;
  }

  if (lastDataTsMs != null && Number.isFinite(lastDataTsMs) && lastDataTsMs > trimFromMs) {
    return Math.min(lastDataTsMs, nyWallTimeMs(sessionYmd, GLANCE_RTH_CLOSE_MIN));
  }

  return nyWallTimeMs(sessionYmd, GLANCE_RTH_CLOSE_MIN);
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
 * Wall-clock x-axis for US equity glance charts.
 * RTH live: 09:30–16:00. Overnight bridge: prior 15:00 through today's 09:30 open.
 * Post-close: 15:00–20:00. Otherwise last RTH hour through the 16:00 close.
 */
export function resolveGlanceTileChartAxisDomain(
  ctx: GlanceTileChartWindowCtx,
  item?: GlanceTileChartItemRef | GlanceTileChartItemRef[],
  lastDataTsMs?: number | null,
): { startMs: number; endMs: number; mode: GlanceChartWindowMode } | null {
  const items = item == null ? [] : Array.isArray(item) ? item : [item];
  if (items.length === 1 && !isUsEquityGlanceItem(items[0]!)) return null;
  if (items.length > 1 && items.every((entry) => !isUsEquityGlanceItem(entry))) return null;

  const trimFromMs = resolveGlanceTrimFromMs(ctx, item);
  if (trimFromMs == null) return null;

  const mode = resolveGlanceChartWindowMode(ctx, item);
  const endMs = resolveGlanceTileChartAxisEndMs(ctx, trimFromMs, item, lastDataTsMs);

  return { startMs: trimFromMs, endMs: Math.max(trimFromMs, endMs), mode };
}

/** Gray extended-hours band bounds on the fixed time axis. */
export function resolveGlanceExtendedShadeX(
  ctx: GlanceTileChartWindowCtx,
  axis: { startMs: number; endMs: number },
  lastDataTsMs: number | null,
): { fromMs: number; toMs: number } | null {
  const sessionYmd = (ctx.sessionYmd ?? nyYmd(new Date(ctxNowMs(ctx)))).trim();
  if (!sessionYmd) return null;

  const lastX =
    lastDataTsMs != null && Number.isFinite(lastDataTsMs)
      ? lastDataTsMs
      : nyWallTimeMs(sessionYmd, GLANCE_RTH_CLOSE_MIN);

  if (ctx.marketOpen) {
    const openMs = nyWallTimeMs(sessionYmd, GLANCE_RTH_OPEN_MIN);
    if (axis.startMs >= openMs) return null;
    return { fromMs: axis.startMs, toMs: Math.min(openMs, axis.endMs) };
  }

  const closeMs = nyWallTimeMs(sessionYmd, GLANCE_RTH_CLOSE_MIN);
  return {
    fromMs: closeMs,
    toMs: Math.max(closeMs, Math.min(lastX, axis.endMs)),
  };
}

/** Show gray extended segment when closed (after-hours / overnight bridge). RTH charts are regular session only. */
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

  return !options.sessionOpen;
}

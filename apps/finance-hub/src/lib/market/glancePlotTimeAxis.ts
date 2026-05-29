import { nyWallTimeMs } from "@/lib/market/futuresGlanceSession";
import { nyYmd } from "@/lib/market/usEquitySession";

import {
  GLANCE_POST_MARKET_END_MIN,
  GLANCE_PREMARKET_START_MIN,
  GLANCE_RTH_CLOSE_MIN,
  resolveGlanceExtendedShadeX,
  resolveGlanceTileChartAxisDomain,
  type GlanceChartWindowMode,
  type GlanceTileChartItemRef,
  type GlanceTileChartWindowCtx,
} from "@/lib/market/glanceTileChartWindow";

export type GlanceOvernightGap = {
  /** After-hours end on the prior session day (20:00 ET). */
  fromMs: number;
  /** Pre-market start on the chart day (04:00 ET). */
  toMs: number;
  skipMs: number;
};

export type GlancePlotAxis = {
  mode: GlanceChartWindowMode;
  wallStartMs: number;
  wallEndMs: number;
  plotStartMs: number;
  plotEndMs: number;
  compress: boolean;
};

function ctxChartYmd(ctx: GlanceTileChartWindowCtx): string {
  return (ctx.chartYmd ?? nyYmd(new Date(ctx.nowMs ?? Date.now()))).trim();
}

/** Non-trading window between prior-day after-hours and next-day pre-market. */
export function resolveGlanceOvernightGap(ctx: GlanceTileChartWindowCtx): GlanceOvernightGap | null {
  const sessionYmd = ctx.sessionYmd?.trim();
  const chartYmd = ctxChartYmd(ctx);
  if (!sessionYmd || !chartYmd || sessionYmd >= chartYmd) return null;

  const fromMs = nyWallTimeMs(sessionYmd, GLANCE_POST_MARKET_END_MIN);
  const toMs = nyWallTimeMs(chartYmd, GLANCE_PREMARKET_START_MIN);
  if (toMs <= fromMs) return null;

  return { fromMs, toMs, skipMs: toMs - fromMs };
}

export function isGlanceOvernightDeadZone(
  tsMs: number,
  ctx: GlanceTileChartWindowCtx,
  mode: GlanceChartWindowMode,
): boolean {
  if (mode !== "overnight_bridge") return false;
  const gap = resolveGlanceOvernightGap(ctx);
  if (!gap) return false;
  return tsMs > gap.fromMs && tsMs < gap.toMs;
}

/** Map wall-clock timestamps to plot coordinates (excises 20:00–04:00 on overnight bridge). */
export function wallClockToGlancePlotMs(
  tsMs: number,
  ctx: GlanceTileChartWindowCtx,
  mode: GlanceChartWindowMode,
): number {
  if (mode !== "overnight_bridge") return tsMs;
  const gap = resolveGlanceOvernightGap(ctx);
  if (!gap || tsMs <= gap.fromMs) return tsMs;
  if (tsMs >= gap.toMs) return tsMs - gap.skipMs;
  return gap.fromMs;
}

/** Inverse of {@link wallClockToGlancePlotMs} for axis tick labels. */
export function glancePlotMsToWallClock(
  plotMs: number,
  ctx: GlanceTileChartWindowCtx,
  mode: GlanceChartWindowMode,
): number {
  if (mode !== "overnight_bridge") return plotMs;
  const gap = resolveGlanceOvernightGap(ctx);
  if (!gap || plotMs <= gap.fromMs) return plotMs;
  return plotMs + gap.skipMs;
}

export function resolveGlancePlotAxis(
  ctx: GlanceTileChartWindowCtx,
  item?: GlanceTileChartItemRef | GlanceTileChartItemRef[],
  lastDataTsMs?: number | null,
): GlancePlotAxis | null {
  const domain = resolveGlanceTileChartAxisDomain(ctx, item, lastDataTsMs);
  if (!domain) return null;

  const compress = domain.mode === "overnight_bridge" && resolveGlanceOvernightGap(ctx) != null;
  const toPlot = (ts: number) => wallClockToGlancePlotMs(ts, ctx, domain.mode);

  return {
    mode: domain.mode,
    wallStartMs: domain.startMs,
    wallEndMs: domain.endMs,
    plotStartMs: toPlot(domain.startMs),
    plotEndMs: toPlot(domain.endMs),
    compress,
  };
}

export function glanceWallMsToPlot(
  wallMs: number,
  plotAxis: GlancePlotAxis,
  ctx: GlanceTileChartWindowCtx,
): number {
  return plotAxis.compress ? wallClockToGlancePlotMs(wallMs, ctx, plotAxis.mode) : wallMs;
}

/** Extended-hours grey bands in plot coordinates (split across overnight gap when compressed). */
export function resolveGlanceExtendedShadePlotSegments(
  ctx: GlanceTileChartWindowCtx,
  plotAxis: GlancePlotAxis,
  lastDataTsMs: number | null,
): Array<{ fromMs: number; toMs: number }> {
  const toPlot = (ts: number) => glanceWallMsToPlot(ts, plotAxis, ctx);
  const sessionYmd = ctx.sessionYmd?.trim();
  if (!sessionYmd) return [];

  if (plotAxis.compress && plotAxis.mode === "overnight_bridge") {
    const chartYmd = ctxChartYmd(ctx);
    const closeMs = nyWallTimeMs(sessionYmd, GLANCE_RTH_CLOSE_MIN);
    const ahEndMs = nyWallTimeMs(sessionYmd, GLANCE_POST_MARKET_END_MIN);
    const preStartMs = nyWallTimeMs(chartYmd, GLANCE_PREMARKET_START_MIN);
    const lastX = lastDataTsMs ?? ahEndMs;
    const segments: Array<{ fromMs: number; toMs: number }> = [];

    if (lastX >= closeMs) {
      segments.push({
        fromMs: toPlot(closeMs),
        toMs: toPlot(Math.min(Math.max(lastX, closeMs), ahEndMs)),
      });
    }
    if (lastX >= preStartMs) {
      segments.push({
        fromMs: toPlot(preStartMs),
        toMs: toPlot(Math.min(lastX, plotAxis.wallEndMs)),
      });
    }
    return segments.filter((segment) => segment.toMs > segment.fromMs);
  }

  const shade = resolveGlanceExtendedShadeX(
    ctx,
    { startMs: plotAxis.wallStartMs, endMs: plotAxis.wallEndMs },
    lastDataTsMs,
  );
  if (!shade) return [];
  return [{ fromMs: toPlot(shade.fromMs), toMs: toPlot(shade.toMs) }];
}

export function enrichGlanceRowsWithPlotMs<T extends { tsMs?: number | null }>(
  rows: T[],
  ctx: GlanceTileChartWindowCtx,
  plotAxis: GlancePlotAxis,
): Array<T & { plotMs: number | null }> {
  return rows
    .filter((row) => row.tsMs != null && Number.isFinite(row.tsMs))
    .filter((row) => !isGlanceOvernightDeadZone(row.tsMs!, ctx, plotAxis.mode))
    .map((row) => ({
      ...row,
      plotMs: wallClockToGlancePlotMs(row.tsMs!, ctx, plotAxis.mode),
    }));
}

export function glanceChartXDataKey(plotAxis: GlancePlotAxis | null | undefined): "plotMs" | "tsMs" {
  return plotAxis?.compress ? "plotMs" : "tsMs";
}

export function glanceChartXDomain(
  plotAxis: GlancePlotAxis | null | undefined,
  fallback: { startMs: number; endMs: number } | null,
): [number, number] | null {
  if (plotAxis) return [plotAxis.plotStartMs, plotAxis.plotEndMs];
  if (fallback) return [fallback.startMs, fallback.endMs];
  return null;
}

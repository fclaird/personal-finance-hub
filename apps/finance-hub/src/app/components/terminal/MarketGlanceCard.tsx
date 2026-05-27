"use client";

import { useMemo } from "react";
import {
  Area,
  AreaChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { GlanceExtendedPhase } from "@/lib/market/glanceExtendedHours";
import { extendedPhaseLabel } from "@/lib/market/glanceExtendedHours";
import {
  glanceItemForTileChart,
  glanceShowExtendedChartSegment,
  GLANCE_RTH_CLOSE_MIN,
  lastGlanceChartDataTsMs,
  resolveGlanceExtendedShadeX,
  resolveGlanceTileChartAxisDomain,
  type GlanceTileChartWindowCtx,
} from "@/lib/market/glanceTileChartWindow";
import { nyWallTimeMs } from "@/lib/market/futuresGlanceSession";
import { cashIndexSegmentLabel, formatLondonGlancePointTime, formatTokyoGlancePointTime } from "@/lib/market/cashIndexGlanceSession";
import type { FuturesGlanceKind } from "@/lib/market/futuresGlanceSession";
import { futuresExtendedPhaseLabel, futuresSegmentLabel } from "@/lib/market/futuresGlanceSession";
import { PortfolioGlanceValue } from "@/app/components/terminal/PortfolioGlanceValue";
import { GlanceAlternateTileTitle } from "@/app/components/terminal/GlanceAlternateTileTitle";
import { posNegClass } from "@/lib/terminal/colors";
import type { GlanceAlternateInstrumentId } from "@/lib/market/glanceAlternateInstrumentIds";
import type { GlanceInstrumentKind, GlanceValueMode } from "@/lib/market/usMarketIndices";

export type GlanceChartPoint = { idx: number; close: number; tsMs?: number };

export type UsMarketGlanceItem = {
  id: string;
  label: string;
  symbol: string;
  last: number | null;
  change: number | null;
  changePct: number | null;
  previousClose: number | null;
  series: GlanceChartPoint[];
  extendedSeries?: GlanceChartPoint[];
  sessionClose?: number | null;
  extendedLast?: number | null;
  extendedChange?: number | null;
  extendedChangePct?: number | null;
  extendedPhase?: GlanceExtendedPhase | null;
  valueMode?: GlanceValueMode;
  netValue?: number | null;
  priorNetValue?: number | null;
  futuresKind?: FuturesGlanceKind;
  instrumentKind?: GlanceInstrumentKind;
  tradableOpen?: boolean;
};

export type MarketGlanceCardProps = {
  item: UsMarketGlanceItem;
  marketOpen?: boolean;
  sessionLabel?: string;
  sessionYmd?: string;
  updatedAt?: string | null;
  /** Shared Y domain across quick-glance tiles (indexed to 100 at prior close). */
  chartYDomain?: [number, number];
  className?: string;
  /** Swappable alternate tile title menu (Markets tab 4th slot). */
  alternateTitleSelector?: {
    options: ReadonlyArray<{ id: GlanceAlternateInstrumentId; label: string }>;
    value: GlanceAlternateInstrumentId;
    onChange: (id: GlanceAlternateInstrumentId) => void;
  };
};

/** Prior session close on the indexed tile chart scale (flat day = 100). */
export const GLANCE_CHART_BASELINE = 100;

export type GlanceChartReferenceBand = {
  priorReferenceY: number;
  sessionCloseReferenceY: number | null;
  splitRowIdx: number | null;
};

/** Prior close (100) through RTH; session-close level for after-hours once the bell rings. */
export function resolveChartReferenceBand(
  item: UsMarketGlanceItem,
  options: {
    showExtendedChart: boolean;
    extendedPhase?: GlanceExtendedPhase | null;
    marketClosed: boolean;
    atClose: number | null;
    priorSessionClose: number | null;
    chartBaseline: number | null;
    sessionCloseRowIdx: number;
  },
): GlanceChartReferenceBand | null {
  const {
    showExtendedChart,
    extendedPhase,
    marketClosed,
    atClose,
    priorSessionClose,
    chartBaseline,
    sessionCloseRowIdx,
  } = options;
  if (chartBaseline == null || !Number.isFinite(chartBaseline)) return null;

  const priorReferenceY = chartBaseline;
  let sessionCloseReferenceY: number | null = null;
  const useSessionCloseRef =
    showExtendedChart && (extendedPhase === "post" || (marketClosed && extendedPhase !== "pre"));
  if (
    useSessionCloseRef &&
    atClose != null &&
    Number.isFinite(atClose) &&
    priorSessionClose != null &&
    Number.isFinite(priorSessionClose)
  ) {
    sessionCloseReferenceY = indexTileChartValue(atClose, priorSessionClose, isIndexedGlanceChartItem(item));
  }

  return {
    priorReferenceY,
    sessionCloseReferenceY,
    splitRowIdx:
      sessionCloseReferenceY != null && Number.isFinite(sessionCloseReferenceY)
        ? sessionCloseRowIdx
        : null,
  };
}

/** @deprecated Use resolveChartReferenceBand — kept for tests migrating to split reference. */
export function resolveChartReferenceY(
  item: UsMarketGlanceItem,
  options: {
    marketClosed: boolean;
    showExtendedChart: boolean;
    atClose: number | null;
    priorSessionClose: number | null;
    chartBaseline: number | null;
  },
): number | null {
  const band = resolveChartReferenceBand(item, {
    showExtendedChart: options.showExtendedChart,
    atClose: options.atClose,
    priorSessionClose: options.priorSessionClose,
    chartBaseline: options.chartBaseline,
    sessionCloseRowIdx: 0,
  });
  if (!band) return null;
  if (
    options.marketClosed &&
    options.showExtendedChart &&
    band.sessionCloseReferenceY != null
  ) {
    return band.sessionCloseReferenceY;
  }
  return band.priorReferenceY;
}

/** Fixed layout zones so every quick-glance tile aligns in the grid. */
export const GLANCE_TILE_HEADER_HEIGHT_CLASS = "h-[2rem]";
export const GLANCE_TILE_CHART_HEIGHT_CLASS = "h-[5.5rem]";
const TILE_HEADER_RULE = "border-b border-zinc-300 dark:border-white/15";
const PCT2 = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const CHART_MARGIN = { top: 0, right: 2, left: 0, bottom: 0 } as const;
const REF_LINE = "#9ca3af";
const NY_TZ = "America/New_York";
/** Gaps longer than this are non-trading (overnight); do not connect lines across them. */
const TRADING_GAP_MS = 45 * 60 * 1000;

function hasTradingGap(beforeTs: number | undefined, afterTs: number | undefined): boolean {
  if (beforeTs == null || afterTs == null || !Number.isFinite(beforeTs) || !Number.isFinite(afterTs)) {
    return false;
  }
  return afterTs - beforeTs > TRADING_GAP_MS;
}

function reindexTileChartRows(rows: TileChartRow[]): TileChartRow[] {
  return rows.map((row, idx) => ({ ...row, idx }));
}

export type TileChartRow = {
  idx: number;
  regular: number | null;
  extended: number | null;
  tsMs?: number;
  segment: "prior" | "regular" | "extended";
  /** RTH / prior path above prior close (green band to reference). */
  gainFill?: number | null;
  /** RTH / prior path below prior close (red band to reference). */
  lossFill?: number | null;
  /** After-hours path above session close (green band to reference). */
  extGainFill?: number | null;
  /** After-hours path below session close (red band to reference). */
  extLossFill?: number | null;
  /** Price stroke above active RTH reference (no stroke when value sits on the reference). */
  gainStroke?: number | null;
  lossStroke?: number | null;
  extGainStroke?: number | null;
  extLossStroke?: number | null;
};

const UP_STROKE = "#22c55e";
const DOWN_STROKE = "#ef4444";

function priceStrokeFromFill(fill: number | null | undefined, referenceY: number): number | null {
  if (fill == null || !Number.isFinite(fill)) return null;
  if (Math.abs(fill - referenceY) <= 1e-9) return null;
  return fill;
}

export function isIndexedGlanceChartItem(item: UsMarketGlanceItem): boolean {
  return item.id === "portfolio" || item.valueMode === "percent";
}

export function indexTileChartValue(
  value: number | null | undefined,
  previousClose: number | null,
  alreadyIndexed: boolean,
): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  if (alreadyIndexed || previousClose == null || !Number.isFinite(previousClose) || previousClose === 0) {
    return value;
  }
  return (value / previousClose) * GLANCE_CHART_BASELINE;
}

/** Map tile rows to indexed scale (100 = prior close) so cross-tile moves are comparable. */
export function indexTileChartRows(rows: TileChartRow[], item: UsMarketGlanceItem): TileChartRow[] {
  const previousClose = resolvePriorSessionClose(item);
  const alreadyIndexed = isIndexedGlanceChartItem(item);
  return rows.map((row) => ({
    ...row,
    regular: indexTileChartValue(row.regular, previousClose, alreadyIndexed),
    extended: indexTileChartValue(row.extended, previousClose, alreadyIndexed),
  }));
}

function collectIndexedChartValues(rows: TileChartRow[]): number[] {
  const vals: number[] = [];
  for (const row of rows) {
    for (const v of [row.regular, row.extended, row.gainFill, row.lossFill, row.extGainFill, row.extLossFill]) {
      if (v != null && Number.isFinite(v)) vals.push(v);
    }
  }
  return vals;
}

/**
 * Tight Y domain for trimmed sparklines: fit visible prices + nearby reference lines,
 * with a small pad so bands and dashes stay readable.
 */
export function yDomainFromChartRange(
  dataMin: number,
  dataMax: number,
  referenceYs: number[] = [],
): [number, number] {
  let minVal = dataMin;
  let maxVal = dataMax;
  if (!Number.isFinite(minVal) || !Number.isFinite(maxVal)) {
    return [GLANCE_CHART_BASELINE - 0.03, GLANCE_CHART_BASELINE + 0.03];
  }
  if (minVal > maxVal) [minVal, maxVal] = [maxVal, minVal];

  const span = Math.max(maxVal - minVal, 0.008);
  const nearMargin = span * 0.4;
  for (const ref of referenceYs) {
    if (ref == null || !Number.isFinite(ref)) continue;
    if (ref >= minVal - nearMargin && ref <= maxVal + nearMargin) {
      minVal = Math.min(minVal, ref);
      maxVal = Math.max(maxVal, ref);
    }
  }

  const pad = Math.max((maxVal - minVal) * 0.05, 0.008);
  return [minVal - pad, maxVal + pad];
}

/** @deprecated Use yDomainFromChartRange — kept for older tests. */
export function yDomainFromIndexedRange(dataMin: number, dataMax: number): [number, number] {
  return yDomainFromChartRange(dataMin, dataMax, [GLANCE_CHART_BASELINE]);
}

function referenceYsFromBand(band: GlanceChartReferenceBand | null): number[] {
  if (!band) return [GLANCE_CHART_BASELINE];
  const refs = [band.priorReferenceY];
  if (band.sessionCloseReferenceY != null && Number.isFinite(band.sessionCloseReferenceY)) {
    refs.push(band.sessionCloseReferenceY);
  }
  return refs;
}

export function sparklineYDomainFromChartData(
  rows: TileChartRow[],
  band: GlanceChartReferenceBand | null,
): [number, number] {
  const vals = collectIndexedChartValues(rows);
  const refs = referenceYsFromBand(band);
  if (vals.length === 0) {
    return yDomainFromChartRange(GLANCE_CHART_BASELINE - 0.02, GLANCE_CHART_BASELINE + 0.02, refs);
  }
  return yDomainFromChartRange(Math.min(...vals), Math.max(...vals), refs);
}

/** Shared Y domain for US equity quick-glance tiles (portfolio + benchmarks). */
export function sharedSparklineYDomain(
  items: UsMarketGlanceItem[],
  windowCtx?: GlanceTileChartWindowCtx,
): [number, number] | undefined {
  const equityItems = items.filter(
    (item) => item.futuresKind == null && item.instrumentKind !== "cash_index",
  );
  if (equityItems.length === 0) return undefined;

  const vals: number[] = [];
  const refs: number[] = [];

  for (const item of equityItems) {
    const { item: chartItem, omitPriorAnchor } = windowCtx
      ? glanceItemForTileChart(item, windowCtx)
      : { item, omitPriorAnchor: false };
    const rows = indexTileChartRows(
      buildTileChartRows(chartItem, { omitPriorAnchor }),
      item,
    );
    for (const row of rows) {
      for (const v of [row.regular, row.extended]) {
        if (v != null && Number.isFinite(v)) vals.push(v);
      }
    }
    refs.push(GLANCE_CHART_BASELINE);
    const prior = resolvePriorSessionClose(item);
    const atClose =
      chartItem.sessionClose ??
      rows.filter((r) => r.regular != null).at(-1)?.regular ??
      null;
    if (atClose != null && chartItem.extendedPhase === "post") {
      const y = indexTileChartValue(atClose, prior, isIndexedGlanceChartItem(item));
      if (y != null) refs.push(y);
    }
  }

  if (vals.length === 0) return undefined;
  return yDomainFromChartRange(Math.min(...vals), Math.max(...vals), refs);
}

function nearPrice(a: number, b: number): boolean {
  const ref = Math.max(Math.abs(a), Math.abs(b), 1e-9);
  return Math.abs(a - b) / ref < 0.00005;
}

function usesSessionCloseReference(rowIdx: number, row: TileChartRow, splitRowIdx: number): boolean {
  if (row.extended == null || row.segment === "prior") return false;
  return rowIdx >= splitRowIdx;
}

function extendedReferenceY(
  rowIdx: number,
  row: TileChartRow,
  priorReferenceY: number,
  splitRowIdx: number | null,
  sessionCloseReferenceY: number | null,
): number {
  if (
    splitRowIdx != null &&
    sessionCloseReferenceY != null &&
    usesSessionCloseReference(rowIdx, row, splitRowIdx)
  ) {
    return sessionCloseReferenceY;
  }
  return priorReferenceY;
}

/** Green/red bands between price and the active reference (prior close, then session close after the bell). */
export function enrichTileChartRowsForBaselineChart(
  rows: TileChartRow[],
  priorReferenceY: number | null,
  band?: GlanceChartReferenceBand | null,
): TileChartRow[] {
  if (priorReferenceY == null || !Number.isFinite(priorReferenceY)) {
    return rows;
  }

  const splitRowIdx = band?.splitRowIdx ?? null;
  const sessionCloseReferenceY = band?.sessionCloseReferenceY ?? null;

  const out: TileChartRow[] = [];
  let lastRegular: number | null = null;
  let lastExtended: number | null = null;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const regular = row.regular;
    const extended = row.extended;
    const extRefY = extendedReferenceY(i, row, priorReferenceY, splitRowIdx, sessionCloseReferenceY);

    if (regular != null && Number.isFinite(regular)) {
      if (
        lastRegular != null &&
        (lastRegular >= priorReferenceY) !== (regular >= priorReferenceY)
      ) {
        out.push({
          idx: out.length,
          regular: null,
          extended: null,
          gainFill: priorReferenceY,
          lossFill: priorReferenceY,
          gainStroke: priorReferenceY,
          lossStroke: priorReferenceY,
          segment: row.segment,
          tsMs: row.tsMs,
        });
      }
    }

    if (extended != null && Number.isFinite(extended)) {
      if (
        lastExtended != null &&
        (lastExtended >= extRefY) !== (extended >= extRefY)
      ) {
        out.push({
          idx: out.length,
          regular: null,
          extended: null,
          extGainFill: extRefY,
          extLossFill: extRefY,
          extGainStroke: extRefY,
          extLossStroke: extRefY,
          segment: row.segment,
          tsMs: row.tsMs,
        });
      }
    }

    const aboveRegular = regular != null && Number.isFinite(regular) && regular >= priorReferenceY;
    const aboveExtended = extended != null && Number.isFinite(extended) && extended >= extRefY;

    const gainFill = regular != null && Number.isFinite(regular) ? (aboveRegular ? regular : null) : null;
    const lossFill = regular != null && Number.isFinite(regular) ? (aboveRegular ? null : regular) : null;
    const extGainFill =
      extended != null && Number.isFinite(extended) ? (aboveExtended ? extended : null) : null;
    const extLossFill =
      extended != null && Number.isFinite(extended) ? (aboveExtended ? null : extended) : null;

    out.push({
      ...row,
      gainFill,
      lossFill,
      extGainFill,
      extLossFill,
      gainStroke: priceStrokeFromFill(gainFill, priorReferenceY),
      lossStroke: priceStrokeFromFill(lossFill, priorReferenceY),
      extGainStroke: extGainFill,
      extLossStroke: extLossFill,
    });

    if (regular != null && Number.isFinite(regular)) lastRegular = regular;
    if (extended != null && Number.isFinite(extended)) lastExtended = extended;
  }

  return bridgeTileShadingAtSessionClose(reindexTileChartRows(out), priorReferenceY);
}

export function resolveTileExtendedHandoff(
  rows: TileChartRow[],
): { lastRegularIdx: number; firstExtendedOnlyIdx: number } | null {
  let lastRegularIdx = -1;
  let firstExtendedOnlyIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if (row.regular != null && Number.isFinite(row.regular)) lastRegularIdx = i;
    if (
      firstExtendedOnlyIdx < 0 &&
      row.extended != null &&
      Number.isFinite(row.extended) &&
      row.regular == null &&
      row.segment !== "prior"
    ) {
      firstExtendedOnlyIdx = i;
    }
  }
  if (lastRegularIdx < 0 || firstExtendedOnlyIdx < 0 || firstExtendedOnlyIdx <= lastRegularIdx) {
    return null;
  }
  return { lastRegularIdx, firstExtendedOnlyIdx };
}

/** Carry RTH fill and gray-zone fills across the session-close handoff so nothing gaps. */
export function bridgeTileShadingAtSessionClose(
  rows: TileChartRow[],
  priorReferenceY: number,
): TileChartRow[] {
  const handoff = resolveTileExtendedHandoff(rows);
  if (!handoff) return rows;

  const { lastRegularIdx, firstExtendedOnlyIdx } = handoff;
  const closePrice = rows[lastRegularIdx]!.regular;
  if (closePrice == null || !Number.isFinite(closePrice)) return rows;

  const above = closePrice >= priorReferenceY;
  const bridgeGain = above ? closePrice : null;
  const bridgeLoss = above ? null : closePrice;

  const out = rows.map((row) => ({ ...row }));

  for (let i = lastRegularIdx + 1; i < firstExtendedOnlyIdx; i++) {
    const row = out[i]!;
    if (row.gainFill == null && row.lossFill == null) {
      row.gainFill = bridgeGain;
      row.lossFill = bridgeLoss;
      row.gainStroke = row.gainStroke ?? priceStrokeFromFill(bridgeGain, priorReferenceY);
      row.lossStroke = row.lossStroke ?? priceStrokeFromFill(bridgeLoss, priorReferenceY);
    }
  }

  const firstExt = out[firstExtendedOnlyIdx]!;
  if (firstExt.gainFill == null && firstExt.lossFill == null) {
    firstExt.gainFill = bridgeGain;
    firstExt.lossFill = bridgeLoss;
    firstExt.gainStroke = firstExt.gainStroke ?? priceStrokeFromFill(bridgeGain, priorReferenceY);
    firstExt.lossStroke = firstExt.lossStroke ?? priceStrokeFromFill(bridgeLoss, priorReferenceY);
  }

  return reindexTileChartRows(out);
}

export function tileExtendedShadeStartX(rows: TileChartRow[], shadeFromIdx: number): number {
  const handoff = resolveTileExtendedHandoff(rows);
  if (handoff) {
    const leftRow = rows[handoff.lastRegularIdx];
    const rightRow = rows[handoff.firstExtendedOnlyIdx];
    const leftTs = leftRow?.tsMs;
    const rightTs = rightRow?.tsMs;
    if (leftTs != null && rightTs != null && Number.isFinite(leftTs) && Number.isFinite(rightTs)) {
      return (leftTs + rightTs) / 2;
    }
    const left = leftRow?.idx ?? handoff.lastRegularIdx;
    const right = rightRow?.idx ?? handoff.firstExtendedOnlyIdx;
    return (left + right) / 2;
  }
  const row = rows[shadeFromIdx];
  if (row?.tsMs != null && Number.isFinite(row.tsMs)) return row.tsMs;
  return row?.idx ?? shadeFromIdx;
}

/** RTH path in regular column; pre/post in extended (gray). Prior close anchors the left. */
export function buildTileChartRows(
  item: UsMarketGlanceItem,
  options?: { omitPriorAnchor?: boolean },
): TileChartRow[] {
  const prev = item.previousClose;
  const rows: TileChartRow[] = [];

  if (prev != null && Number.isFinite(prev) && !options?.omitPriorAnchor) {
    rows.push({ idx: 0, regular: prev, extended: null, segment: "prior" });
  }

  for (const p of item.series) {
    if (rows.length === 1 && prev != null && nearPrice(p.close, prev)) continue;
    const lastRow = rows[rows.length - 1];
    if (lastRow?.tsMs != null && p.tsMs != null && hasTradingGap(lastRow.tsMs, p.tsMs)) {
      rows.push({
        idx: rows.length,
        regular: null,
        extended: null,
        segment: "regular",
      });
    }
    const tail = rows[rows.length - 1]?.regular;
    if (tail != null && nearPrice(p.close, tail)) continue;
    rows.push({
      idx: rows.length,
      regular: p.close,
      extended: null,
      tsMs: p.tsMs,
      segment: "regular",
    });
  }

  const ext = item.extendedSeries ?? [];
  if (ext.length < 2) return reindexTileChartRows(rows);

  const lastRow = rows[rows.length - 1];
  const anchor = lastRow?.regular ?? item.sessionClose;
  let start = 0;

  const nextExtTs = ext.length > 1 ? ext[1]!.tsMs : ext[0]!.tsMs;
  const canAttachAtClose =
    lastRow != null &&
    ext[0] != null &&
    anchor != null &&
    !hasTradingGap(lastRow.tsMs, nextExtTs);

  if (canAttachAtClose) {
    lastRow.extended = nearPrice(ext[0]!.close, anchor) ? anchor : ext[0]!.close;
    lastRow.tsMs = lastRow.tsMs ?? ext[0]!.tsMs;
    start = 1;
  } else if (ext[0] != null && anchor != null && nearPrice(ext[0].close, anchor)) {
    start = 1;
  }

  if (start < ext.length && hasTradingGap(lastRow?.tsMs, ext[start]!.tsMs)) {
    rows.push({
      idx: rows.length,
      regular: null,
      extended: null,
      segment: "extended",
    });
  }

  for (let i = start; i < ext.length; i++) {
    if (i > start && hasTradingGap(ext[i - 1]!.tsMs, ext[i]!.tsMs)) {
      rows.push({
        idx: rows.length,
        regular: null,
        extended: null,
        segment: "extended",
      });
    }
    rows.push({
      idx: rows.length,
      regular: null,
      extended: ext[i]!.close,
      tsMs: ext[i]!.tsMs,
      segment: "extended",
    });
  }

  return reindexTileChartRows(rows);
}

/** Prior session close — horizontal reference and fill baseline (100 for indexed portfolio). */
export function resolvePriorSessionClose(item: UsMarketGlanceItem): number | null {
  if (item.previousClose == null || !Number.isFinite(item.previousClose)) return null;
  return item.previousClose;
}

export function formatGlancePointTime(tsMs: number | undefined, segment: TileChartRow["segment"]): string {
  if (segment === "prior") return "Previous session close";
  if (tsMs == null || !Number.isFinite(tsMs)) return "Time unavailable";
  const d = new Date(tsMs);
  const date = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: NY_TZ,
  }).format(d);
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: NY_TZ,
  }).format(d);
  return `${date} · ${time} ET`;
}

export function glancePointSegmentLabel(
  segment: TileChartRow["segment"],
  extendedPhase?: GlanceExtendedPhase | null,
  futuresKind?: FuturesGlanceKind,
  instrumentKind?: GlanceInstrumentKind,
  itemId?: string,
): string {
  if (instrumentKind === "cash_index") {
    return cashIndexSegmentLabel(segment, extendedPhase, itemId === "ftse100" ? "london" : "tokyo");
  }
  if (futuresKind) return futuresSegmentLabel(futuresKind, segment);
  if (segment === "prior") return "Prior close";
  if (segment === "extended") {
    if (extendedPhase === "pre") return "Pre-market";
    return "After hours";
  }
  return "Regular session";
}

function formatGlancePrice(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toFixed(2);
}

/** Convert indexed glance value (100 = flat day) to day % change. */
export function indexValueToDayPct(indexValue: number | null | undefined): number | null {
  if (indexValue == null || !Number.isFinite(indexValue)) return null;
  return indexValue - 100;
}

export function formatGlanceDayPct(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(pct)) return "—";
  return `${pct >= 0 ? "+" : ""}${PCT2.format(pct)}%`;
}

function isPercentGlanceItem(item: UsMarketGlanceItem): boolean {
  return item.valueMode === "percent" || item.id === "portfolio";
}

function formatGlanceMetricValue(item: UsMarketGlanceItem, indexValue: number | null): string {
  if (isPercentGlanceItem(item)) return formatGlanceDayPct(indexValueToDayPct(indexValue));
  return formatGlancePrice(indexValue);
}

function GlanceChartTooltip({
  active,
  payload,
  extendedPhase,
  item,
  chartUsesIndexedScale,
}: {
  active?: boolean;
  payload?: Array<{ dataKey?: string; value?: number | null; payload?: TileChartRow }>;
  extendedPhase?: GlanceExtendedPhase | null;
  item: UsMarketGlanceItem;
  chartUsesIndexedScale?: boolean;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload as TileChartRow | undefined;
  if (!row) return null;

  const extendedEntry = payload.find((p) => p.dataKey === "extended" && p.value != null);
  const regularEntry = payload.find((p) => p.dataKey === "regular" && p.value != null);
  const useExtended = extendedEntry != null && (regularEntry == null || extendedEntry === payload[payload.length - 1]);
  const price = useExtended ? row.extended : row.regular;
  const segment: TileChartRow["segment"] =
    row.segment === "prior" ? "prior" : useExtended ? "extended" : "regular";

  if (price == null || !Number.isFinite(price)) return null;

  return (
    <div className="rounded-lg border border-zinc-300 bg-white px-2.5 py-2 text-[11px] shadow-md dark:border-white/15 dark:bg-zinc-950">
      <div className="font-medium text-zinc-800 dark:text-zinc-100">
        {glancePointSegmentLabel(segment, extendedPhase, item.futuresKind, item.instrumentKind, item.id)}
      </div>
      <div className="mt-0.5 text-zinc-500 dark:text-zinc-400">
        {item.instrumentKind === "cash_index" && segment !== "prior"
          ? item.id === "ftse100"
            ? formatLondonGlancePointTime(row.tsMs)
            : formatTokyoGlancePointTime(row.tsMs)
          : formatGlancePointTime(row.tsMs, segment)}
      </div>
      <div className="mt-1 tabular-nums font-semibold text-zinc-900 dark:text-zinc-50">
        {chartUsesIndexedScale
          ? formatGlanceDayPct(indexValueToDayPct(price))
          : formatGlanceMetricValue(item, price)}
      </div>
    </div>
  );
}

export function MarketGlanceCard({
  item,
  marketOpen = true,
  sessionYmd,
  chartYDomain,
  className,
  alternateTitleSelector,
}: MarketGlanceCardProps) {
  const pct = item.changePct;
  const up = pct == null ? true : pct >= 0;
  const gradGainId = `usmk-${item.id}-gain`;
  const gradLossId = `usmk-${item.id}-loss`;
  const gradExtGainId = `usmk-${item.id}-ext-gain`;
  const gradExtLossId = `usmk-${item.id}-ext-loss`;
  const percentMode = isPercentGlanceItem(item);
  const sessionOpen =
    item.instrumentKind === "cash_index" || item.futuresKind != null
      ? (item.tradableOpen ?? false)
      : marketOpen;
  const chartWindowCtx = useMemo(
    (): GlanceTileChartWindowCtx => ({ marketOpen: sessionOpen, sessionYmd }),
    [sessionOpen, sessionYmd],
  );
  const { item: chartItem, omitPriorAnchor } = useMemo(
    () => glanceItemForTileChart(item, chartWindowCtx),
    [item, chartWindowCtx],
  );
  const chartData = useMemo(
    () => buildTileChartRows(chartItem, { omitPriorAnchor }),
    [chartItem, omitPriorAnchor],
  );
  const priorSessionClose = useMemo(() => resolvePriorSessionClose(item), [item]);
  const chartBaseline =
    priorSessionClose != null && Number.isFinite(priorSessionClose) ? GLANCE_CHART_BASELINE : null;
  const chartUsesIndexedScale = chartBaseline != null;
  const indexedChartData = useMemo(
    () => (chartUsesIndexedScale ? indexTileChartRows(chartData, item) : chartData),
    [chartData, chartUsesIndexedScale, item],
  );
  const hasExtended = (chartItem.extendedSeries?.length ?? 0) >= 2;
  const showExtendedChart = glanceShowExtendedChartSegment(chartItem, {
    sessionOpen,
    sessionYmd,
  });
  const marketClosed = !sessionOpen;
  const rthEndIdx = useMemo(() => {
    for (let i = chartData.length - 1; i >= 0; i--) {
      const row = chartData[i]!;
      if (row.regular != null || row.extended != null) return i;
    }
    return 0;
  }, [chartData]);
  const atClose =
    item.sessionClose ??
    (chartData[rthEndIdx]?.regular != null
      ? chartData[rthEndIdx]!.regular
      : chartData[rthEndIdx]?.extended ?? null);
  const sessionCloseChartIdx = useMemo(() => {
    for (let i = 0; i < indexedChartData.length; i++) {
      const row = indexedChartData[i]!;
      if (row.extended != null && row.regular == null && i > 0) return i - 1;
    }
    for (let i = indexedChartData.length - 1; i >= 0; i--) {
      if (indexedChartData[i]!.regular != null) return i;
    }
    return 0;
  }, [indexedChartData]);
  const referenceBand = useMemo(
    () =>
      resolveChartReferenceBand(item, {
        showExtendedChart,
        extendedPhase: item.extendedPhase,
        marketClosed,
        atClose,
        priorSessionClose,
        chartBaseline,
        sessionCloseRowIdx: sessionCloseChartIdx,
      }),
    [
      item,
      showExtendedChart,
      marketClosed,
      atClose,
      priorSessionClose,
      chartBaseline,
      sessionCloseChartIdx,
    ],
  );
  const baselineChartData = useMemo(
    () => enrichTileChartRowsForBaselineChart(indexedChartData, chartBaseline, referenceBand),
    [indexedChartData, chartBaseline, referenceBand],
  );
  const enrichedSessionCloseIdx = useMemo(() => {
    for (let i = 0; i < baselineChartData.length; i++) {
      const row = baselineChartData[i]!;
      if (row.extended != null && row.regular == null && i > 0) return i - 1;
    }
    for (let i = baselineChartData.length - 1; i >= 0; i--) {
      if (baselineChartData[i]!.regular != null) return i;
    }
    return 0;
  }, [baselineChartData]);
  const useSharedEquityDomain = item.futuresKind == null && item.instrumentKind !== "cash_index";
  const chartAxisDomain = useMemo(() => {
    if (!useSharedEquityDomain) return null;
    const lastTs = lastGlanceChartDataTsMs(baselineChartData);
    return resolveGlanceTileChartAxisDomain(chartWindowCtx, item, lastTs);
  }, [useSharedEquityDomain, chartWindowCtx, item, baselineChartData]);
  const useFixedTimeAxis = useMemo(
    () =>
      chartAxisDomain != null &&
      baselineChartData.some((row) => row.tsMs != null && Number.isFinite(row.tsMs)),
    [chartAxisDomain, baselineChartData],
  );
  const yDomain = useMemo(() => {
    if (useSharedEquityDomain && chartYDomain) return chartYDomain;
    return sparklineYDomainFromChartData(baselineChartData, referenceBand);
  }, [useSharedEquityDomain, chartYDomain, baselineChartData, referenceBand]);
  const lastIdx = baselineChartData.length - 1;
  const extendedShade = useMemo(() => {
    if (!showExtendedChart) return null;
    let first = -1;
    let last = -1;
    for (let i = 0; i < baselineChartData.length; i++) {
      if (baselineChartData[i]!.extended != null) {
        if (first < 0) first = i;
        last = i;
      }
    }
    if (first < 0 || last < 0) return null;
    return { first, last };
  }, [baselineChartData, showExtendedChart]);
  const shadeFromIdx =
    marketClosed && showExtendedChart
      ? enrichedSessionCloseIdx
      : (extendedShade?.first ?? enrichedSessionCloseIdx);
  const shadeToIdx = extendedShade?.last ?? lastIdx;
  const shadeBounds = useMemo(() => {
    if (!showExtendedChart || !useFixedTimeAxis || !chartAxisDomain) return null;
    const lastTs = baselineChartData[lastIdx]?.tsMs ?? null;
    return resolveGlanceExtendedShadeX(chartWindowCtx, chartAxisDomain, lastTs);
  }, [showExtendedChart, useFixedTimeAxis, chartAxisDomain, chartWindowCtx, baselineChartData, lastIdx]);
  const shadeAreaX1 = shadeBounds?.fromMs ?? tileExtendedShadeStartX(baselineChartData, shadeFromIdx);
  const shadeAreaX2 =
    shadeBounds?.toMs ?? baselineChartData[shadeToIdx]?.tsMs ?? baselineChartData[shadeToIdx]?.idx ?? shadeToIdx;
  const atClosePct = indexValueToDayPct(
    chartUsesIndexedScale ? indexTileChartValue(atClose, priorSessionClose, isIndexedGlanceChartItem(item)) : atClose,
  );
  const extendedPct = item.extendedChangePct ?? indexValueToDayPct(item.extendedLast);
  const indexedFooter = chartUsesIndexedScale;
  const showExtendedFooterCols = showExtendedChart;

  const priorReferenceY = referenceBand?.priorReferenceY ?? chartBaseline;
  const sessionCloseReferenceY = referenceBand?.sessionCloseReferenceY ?? null;
  const firstChartIdx = baselineChartData[0]?.idx ?? 0;
  const closeChartIdx = baselineChartData[enrichedSessionCloseIdx]?.idx ?? enrichedSessionCloseIdx;
  const lastChartIdx = baselineChartData[lastIdx]?.idx ?? lastIdx;
  const sessionCloseBoundaryMs =
    marketClosed && sessionYmd ? nyWallTimeMs(sessionYmd, GLANCE_RTH_CLOSE_MIN) : null;
  const firstChartX = useFixedTimeAxis ? chartAxisDomain!.startMs : firstChartIdx;
  const lastChartX = useFixedTimeAxis
    ? (baselineChartData[lastIdx]?.tsMs ?? chartAxisDomain!.endMs)
    : lastChartIdx;
  const closeChartX = useFixedTimeAxis
    ? (baselineChartData[enrichedSessionCloseIdx]?.tsMs ?? sessionCloseBoundaryMs ?? closeChartIdx)
    : closeChartIdx;
  const priorRefEndX =
    sessionCloseReferenceY != null && showExtendedChart ? closeChartX : lastChartX;

  const renderLastDot = (
    series: "gainStroke" | "lossStroke" | "extGainStroke" | "extLossStroke",
    props: { index?: number; cx?: number; cy?: number; payload?: TileChartRow },
  ) => {
    const { index, cx, cy, payload } = props;
    if (cx == null || cy == null || payload == null) return null;
    if (index !== lastIdx) return null;
    const lastRow = baselineChartData[lastIdx];
    const useExtended =
      lastRow != null &&
      (lastRow.extGainStroke != null || lastRow.extLossStroke != null) &&
      (series === "extGainStroke" || series === "extLossStroke");
    const useRegular =
      lastRow != null &&
      (lastRow.gainStroke != null || lastRow.lossStroke != null) &&
      (series === "gainStroke" || series === "lossStroke");
    if (!useExtended && !useRegular) return null;
    const value =
      series === "gainStroke"
        ? payload.gainStroke
        : series === "lossStroke"
          ? payload.lossStroke
          : series === "extGainStroke"
            ? payload.extGainStroke
            : payload.extLossStroke;
    if (value == null || !Number.isFinite(value)) return null;
    const dotFill = series === "gainStroke" || series === "extGainStroke" ? UP_STROKE : DOWN_STROKE;
    return (
      <circle cx={cx} cy={cy} r={3.5} fill={dotFill} stroke="#fff" strokeWidth={1.5} className="dark:stroke-zinc-900" />
    );
  };

  return (
    <div
      className={
        "relative min-w-0 overflow-hidden rounded-xl border bg-zinc-50 dark:bg-zinc-900/80 " +
        (marketClosed
          ? "border-amber-300/60 dark:border-amber-500/30"
          : "border-zinc-300 dark:border-white/15") +
        (className ? ` ${className}` : "")
      }
    >
      {marketClosed ? (
        <div className="flex items-center gap-1.5 border-b border-amber-300/50 bg-amber-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-amber-900 dark:border-amber-500/25 dark:bg-amber-950/40 dark:text-amber-200">
          <span aria-hidden className="text-amber-500">
            ☀
          </span>
          {item.futuresKind ? "Futures closed" : "Market closed"}
        </div>
      ) : null}

      <div
        className={
          "box-border shrink-0 px-3 pt-2 " + GLANCE_TILE_HEADER_HEIGHT_CLASS + " " + TILE_HEADER_RULE
        }
      >
        <div className="flex h-full min-h-0 items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              {alternateTitleSelector ? (
                <GlanceAlternateTileTitle
                  label={item.label}
                  options={alternateTitleSelector.options}
                  value={alternateTitleSelector.value}
                  onChange={alternateTitleSelector.onChange}
                />
              ) : (
                <div className="text-xs font-medium text-zinc-700 dark:text-zinc-200">{item.label}</div>
              )}
              {item.instrumentKind === "cash_index" ? (
                <span className="rounded bg-zinc-200/80 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                  Cash index
                </span>
              ) : null}
            </div>
          </div>
          {item.id === "portfolio" ? (
            <div className="shrink-0 self-start text-right">
              <PortfolioGlanceValue netValue={item.netValue} />
            </div>
          ) : showExtendedChart ? (
            <span className="shrink-0 self-start text-[10px] font-medium leading-5 text-zinc-400 dark:text-zinc-500">
              {item.futuresKind
                ? futuresExtendedPhaseLabel(item.extendedPhase, item.futuresKind)
                : extendedPhaseLabel(item.extendedPhase)}
            </span>
          ) : null}
        </div>
      </div>

      <div className={"shrink-0 px-3 pt-1.5 " + GLANCE_TILE_CHART_HEIGHT_CLASS}>
        {chartData.length >= 2 ? (
          <div className="h-full w-full min-w-0">
            <ResponsiveContainer width="100%" height="100%" minWidth={64} minHeight={72}>
              <AreaChart data={baselineChartData} margin={CHART_MARGIN}>
                {useFixedTimeAxis ? (
                  <XAxis
                    dataKey="tsMs"
                    hide
                    type="number"
                    domain={[chartAxisDomain!.startMs, chartAxisDomain!.endMs]}
                    allowDataOverflow
                  />
                ) : (
                  <XAxis dataKey="idx" hide type="number" domain={["dataMin", "dataMax"]} />
                )}
                <YAxis hide domain={yDomain} />
                <Tooltip
                  content={
                    <GlanceChartTooltip
                      extendedPhase={item.extendedPhase}
                      item={item}
                      chartUsesIndexedScale={chartUsesIndexedScale}
                    />
                  }
                  cursor={{ stroke: REF_LINE, strokeWidth: 1, strokeDasharray: "3 3" }}
                  isAnimationActive={false}
                />
                <defs>
                  <linearGradient id={gradGainId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={UP_STROKE} stopOpacity={0.88} />
                    <stop offset="100%" stopColor={UP_STROKE} stopOpacity={0.42} />
                  </linearGradient>
                  <linearGradient id={gradLossId} x1="0" y1="1" x2="0" y2="0">
                    <stop offset="0%" stopColor={DOWN_STROKE} stopOpacity={0.88} />
                    <stop offset="100%" stopColor={DOWN_STROKE} stopOpacity={0.42} />
                  </linearGradient>
                  <linearGradient id={gradExtGainId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={UP_STROKE} stopOpacity={0.88} />
                    <stop offset="100%" stopColor={UP_STROKE} stopOpacity={0.42} />
                  </linearGradient>
                  <linearGradient id={gradExtLossId} x1="0" y1="1" x2="0" y2="0">
                    <stop offset="0%" stopColor={DOWN_STROKE} stopOpacity={0.88} />
                    <stop offset="100%" stopColor={DOWN_STROKE} stopOpacity={0.42} />
                  </linearGradient>
                </defs>
                {priorReferenceY != null && Number.isFinite(priorReferenceY) ? (
                  <ReferenceLine
                    segment={[
                      { x: firstChartX, y: priorReferenceY },
                      { x: priorRefEndX, y: priorReferenceY },
                    ]}
                    stroke={REF_LINE}
                    strokeDasharray="4 4"
                    strokeOpacity={0.75}
                    ifOverflow="extendDomain"
                  />
                ) : null}
                {sessionCloseReferenceY != null &&
                Number.isFinite(sessionCloseReferenceY) &&
                showExtendedChart ? (
                  <ReferenceLine
                    segment={[
                      { x: closeChartX, y: sessionCloseReferenceY },
                      { x: lastChartX, y: sessionCloseReferenceY },
                    ]}
                    stroke={REF_LINE}
                    strokeDasharray="4 4"
                    strokeOpacity={0.75}
                    ifOverflow="extendDomain"
                  />
                ) : null}
                {showExtendedChart ? (
                  <ReferenceArea
                    x1={shadeAreaX1}
                    x2={shadeAreaX2}
                    fill="#94a3b8"
                    fillOpacity={0.22}
                    ifOverflow="extendDomain"
                  />
                ) : null}
                {chartBaseline != null && Number.isFinite(chartBaseline) ? (
                  <>
                    <Area
                      type="linear"
                      dataKey="gainFill"
                      baseValue={priorReferenceY ?? chartBaseline}
                      stroke="none"
                      fill={`url(#${gradGainId})`}
                      strokeWidth={0}
                      isAnimationActive={false}
                      connectNulls
                      legendType="none"
                    />
                    <Area
                      type="linear"
                      dataKey="lossFill"
                      baseValue={priorReferenceY ?? chartBaseline}
                      stroke="none"
                      fill={`url(#${gradLossId})`}
                      strokeWidth={0}
                      isAnimationActive={false}
                      connectNulls
                      legendType="none"
                    />
                    <Line
                      type="linear"
                      dataKey="gainStroke"
                      stroke={UP_STROKE}
                      strokeWidth={2}
                      dot={(props) => renderLastDot("gainStroke", props)}
                      fill="none"
                      isAnimationActive={false}
                      connectNulls={false}
                      legendType="none"
                    />
                    <Line
                      type="linear"
                      dataKey="lossStroke"
                      stroke={DOWN_STROKE}
                      strokeWidth={2}
                      dot={(props) => renderLastDot("lossStroke", props)}
                      fill="none"
                      isAnimationActive={false}
                      connectNulls={false}
                      legendType="none"
                    />
                    {sessionCloseReferenceY != null && showExtendedChart ? (
                      <>
                        <Area
                          type="linear"
                          dataKey="extGainFill"
                          baseValue={sessionCloseReferenceY}
                          stroke="none"
                          fill={`url(#${gradExtGainId})`}
                          strokeWidth={0}
                          isAnimationActive={false}
                          connectNulls
                          legendType="none"
                        />
                        <Area
                          type="linear"
                          dataKey="extLossFill"
                          baseValue={sessionCloseReferenceY}
                          stroke="none"
                          fill={`url(#${gradExtLossId})`}
                          strokeWidth={0}
                          isAnimationActive={false}
                          connectNulls
                          legendType="none"
                        />
                        <Line
                          type="linear"
                          dataKey="extGainStroke"
                          stroke={UP_STROKE}
                          strokeWidth={2}
                          dot={(props) => renderLastDot("extGainStroke", props)}
                          fill="none"
                          isAnimationActive={false}
                          connectNulls={false}
                          legendType="none"
                        />
                        <Line
                          type="linear"
                          dataKey="extLossStroke"
                          stroke={DOWN_STROKE}
                          strokeWidth={2}
                          dot={(props) => renderLastDot("extLossStroke", props)}
                          fill="none"
                          isAnimationActive={false}
                          connectNulls={false}
                          legendType="none"
                        />
                      </>
                    ) : null}
                  </>
                ) : (
                  <Area
                    type="linear"
                    dataKey="regular"
                    stroke={up ? UP_STROKE : DOWN_STROKE}
                    fill="none"
                    strokeWidth={2}
                    isAnimationActive={false}
                    connectNulls={false}
                  />
                )}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="flex h-full items-center text-[10px] text-zinc-500">No intraday data</div>
        )}
      </div>

      <div className="px-3 pb-3 pt-2">
        <div
          className={
            "mt-2 grid gap-2 border-t border-zinc-200/80 pt-2 dark:border-white/10 " +
            (indexedFooter
              ? showExtendedFooterCols
                ? "grid-cols-2 sm:grid-cols-4"
                : percentMode
                  ? "grid-cols-2"
                  : "grid-cols-2 sm:grid-cols-4"
              : hasExtended
                ? "grid-cols-2 sm:grid-cols-4"
                : "grid-cols-3")
          }
        >
          {indexedFooter ? (
            <>
              <div>
                <div className="text-[10px] text-zinc-500 dark:text-zinc-400">Day start</div>
                <div className="text-xs font-medium tabular-nums text-zinc-800 dark:text-zinc-100">0.00%</div>
              </div>
              {showExtendedFooterCols ? (
                <div>
                  <div className="text-[10px] text-zinc-500 dark:text-zinc-400">At close</div>
                  <div className={"text-xs font-medium tabular-nums " + posNegClass(atClosePct)}>
                    {formatGlanceDayPct(atClosePct)}
                  </div>
                </div>
              ) : (
                <div>
                  <div className="text-[10px] text-zinc-500 dark:text-zinc-400">At close</div>
                  <div className="text-xs font-medium tabular-nums text-zinc-500 dark:text-zinc-400">—</div>
                </div>
              )}
              {showExtendedFooterCols ? (
                <div>
                  <div className="text-[10px] text-zinc-500 dark:text-zinc-400">Extended</div>
                  <div className={"text-xs font-medium tabular-nums " + posNegClass(extendedPct)}>
                    {formatGlanceDayPct(extendedPct)}
                  </div>
                </div>
              ) : (
                <div>
                  <div className="text-[10px] text-zinc-500 dark:text-zinc-400">Extended</div>
                  <div className="text-xs font-medium tabular-nums text-zinc-500 dark:text-zinc-400">—</div>
                </div>
              )}
              <div>
                <div className="text-[10px] text-zinc-500 dark:text-zinc-400">Day</div>
                <div className={"text-xs font-medium tabular-nums " + posNegClass(pct)}>
                  {formatGlanceDayPct(pct)}
                </div>
              </div>
            </>
          ) : (
            <>
              <div>
                <div className="text-[10px] text-zinc-500 dark:text-zinc-400">Prev close</div>
                <div className="text-xs font-medium tabular-nums text-zinc-800 dark:text-zinc-100">
                  {formatGlancePrice(item.previousClose)}
                </div>
              </div>
              {showExtendedChart ? (
                <div>
                  <div className="text-[10px] text-zinc-500 dark:text-zinc-400">At close</div>
                  <div className="text-xs font-medium tabular-nums text-zinc-800 dark:text-zinc-100">
                    {formatGlancePrice(atClose)}
                  </div>
                </div>
              ) : null}
              <div>
                <div className="text-[10px] text-zinc-500 dark:text-zinc-400">Current</div>
                <div className="text-xs font-medium tabular-nums text-zinc-800 dark:text-zinc-100">
                  {formatGlancePrice(item.last)}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-zinc-500 dark:text-zinc-400">Day %</div>
                <div className={"text-xs font-medium tabular-nums " + posNegClass(pct)}>
                  {pct == null ? "—" : `${pct >= 0 ? "+" : ""}${PCT2.format(pct)}%`}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

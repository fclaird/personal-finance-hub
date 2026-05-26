"use client";

import { useMemo } from "react";
import {
  Area,
  AreaChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { GlanceExtendedPhase } from "@/lib/market/glanceExtendedHours";
import { extendedPhaseLabel } from "@/lib/market/glanceExtendedHours";
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
  /** Price path above prior close (green line + fill to baseline). */
  gainFill?: number | null;
  /** Price path below prior close (red line + fill to baseline). */
  lossFill?: number | null;
};

const UP_STROKE = "#22c55e";
const DOWN_STROKE = "#ef4444";

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
    for (const v of [row.regular, row.extended, row.gainFill, row.lossFill]) {
      if (v != null && Number.isFinite(v)) vals.push(v);
    }
  }
  return vals;
}

/**
 * Shared tile Y domain: one scale across tiles. The most extreme data point sits on the
 * relevant top/bottom bound; baseline keeps a sliver of room on the opposite side only.
 */
export function yDomainFromIndexedRange(dataMin: number, dataMax: number): [number, number] {
  const baseline = GLANCE_CHART_BASELINE;
  const minVal = Math.min(dataMin, baseline);
  const maxVal = Math.max(dataMax, baseline);
  const above = maxVal - baseline;
  const below = baseline - minVal;
  const atBaselineEpsilon = 0.012;
  /** Small slack so the dashed baseline stays visible when all moves are one-sided. */
  const baselineSlack = 0.008;

  if (below <= atBaselineEpsilon && above > atBaselineEpsilon) {
    return [baseline - Math.min(baselineSlack, above * 0.04), maxVal];
  }

  if (above <= atBaselineEpsilon && below > atBaselineEpsilon) {
    return [minVal, baseline + Math.min(baselineSlack, below * 0.04)];
  }

  if (above <= atBaselineEpsilon && below <= atBaselineEpsilon) {
    const bump = 0.03;
    return [baseline - bump, baseline + bump];
  }

  // Mixed up/down — extremes touch top and bottom bounds.
  return [minVal, maxVal];
}

function sparklineYDomainFromRows(rows: TileChartRow[], baseline: number | null): [number, number] {
  const vals = collectIndexedChartValues(rows);
  if (vals.length === 0 || baseline == null || !Number.isFinite(baseline)) {
    return yDomainFromIndexedRange(GLANCE_CHART_BASELINE - 0.08, GLANCE_CHART_BASELINE + 0.08);
  }
  return yDomainFromIndexedRange(Math.min(...vals), Math.max(...vals));
}

/** Shared Y domain for all quick-glance tiles (prior close always at baseline). */
export function sharedSparklineYDomain(items: UsMarketGlanceItem[]): [number, number] {
  const vals: number[] = [];
  for (const item of items) {
    vals.push(...collectIndexedChartValues(indexTileChartRows(buildTileChartRows(item), item)));
  }
  if (vals.length === 0) {
    return yDomainFromIndexedRange(GLANCE_CHART_BASELINE - 0.08, GLANCE_CHART_BASELINE + 0.08);
  }
  return yDomainFromIndexedRange(Math.min(...vals), Math.max(...vals));
}

function nearPrice(a: number, b: number): boolean {
  const ref = Math.max(Math.abs(a), Math.abs(b), 1e-9);
  return Math.abs(a - b) / ref < 0.00005;
}

function pathValueForBaseline(row: TileChartRow): number | null {
  if (row.regular != null && Number.isFinite(row.regular)) return row.regular;
  if (row.extended != null && Number.isFinite(row.extended)) return row.extended;
  return null;
}

/** Green/red line and fill split at prior session close (RTH + extended/pre/post). */
export function enrichTileChartRowsForBaselineChart(
  rows: TileChartRow[],
  priorSessionClose: number | null,
): TileChartRow[] {
  if (priorSessionClose == null || !Number.isFinite(priorSessionClose)) {
    return rows;
  }

  const out: TileChartRow[] = [];
  let lastPath: number | null = null;

  for (const row of rows) {
    const r = pathValueForBaseline(row);
    if (r == null || !Number.isFinite(r)) {
      out.push({ ...row, gainFill: null, lossFill: null });
      lastPath = null;
      continue;
    }

    if (
      lastPath != null &&
      Number.isFinite(lastPath) &&
      (lastPath - priorSessionClose) * (r - priorSessionClose) < 0
    ) {
      out.push({
        idx: out.length,
        regular: null,
        extended: null,
        gainFill: priorSessionClose,
        lossFill: priorSessionClose,
        segment: row.segment,
        tsMs: row.tsMs,
      });
    }

    const above = r >= priorSessionClose;
    out.push({
      ...row,
      gainFill: above ? r : null,
      lossFill: above ? null : r,
    });
    lastPath = r;
  }

  return reindexTileChartRows(out);
}

/** RTH path in regular column; pre/post in extended (gray). Prior close anchors the left. */
export function buildTileChartRows(item: UsMarketGlanceItem): TileChartRow[] {
  const prev = item.previousClose;
  const rows: TileChartRow[] = [];

  if (prev != null && Number.isFinite(prev)) {
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
  chartYDomain,
  className,
  alternateTitleSelector,
}: MarketGlanceCardProps) {
  const pct = item.changePct;
  const up = pct == null ? true : pct >= 0;
  const gradGainId = `usmk-${item.id}-gain`;
  const gradLossId = `usmk-${item.id}-loss`;
  const percentMode = isPercentGlanceItem(item);
  const sessionOpen =
    item.instrumentKind === "cash_index" || item.futuresKind != null
      ? (item.tradableOpen ?? false)
      : marketOpen;
  const chartData = useMemo(() => buildTileChartRows(item), [item]);
  const priorSessionClose = useMemo(() => resolvePriorSessionClose(item), [item]);
  const chartBaseline =
    priorSessionClose != null && Number.isFinite(priorSessionClose) ? GLANCE_CHART_BASELINE : null;
  const chartUsesIndexedScale = chartBaseline != null;
  const indexedChartData = useMemo(
    () => (chartUsesIndexedScale ? indexTileChartRows(chartData, item) : chartData),
    [chartData, chartUsesIndexedScale, item],
  );
  const baselineChartData = useMemo(
    () => enrichTileChartRowsForBaselineChart(indexedChartData, chartBaseline),
    [indexedChartData, chartBaseline],
  );
  const yDomain = chartYDomain ?? sparklineYDomainFromRows(indexedChartData, chartBaseline);
  const hasExtended = (item.extendedSeries?.length ?? 0) >= 2;
  const showExtendedChart =
    hasExtended &&
    !(
      sessionOpen &&
      item.futuresKind == null &&
      item.instrumentKind !== "cash_index"
    );
  const marketClosed = !sessionOpen;
  const lastIdx = baselineChartData.length - 1;
  const rthEndIdx = useMemo(() => {
    for (let i = baselineChartData.length - 1; i >= 0; i--) {
      const row = baselineChartData[i]!;
      if (row.gainFill != null || row.lossFill != null || row.regular != null) return i;
    }
    return 0;
  }, [baselineChartData]);
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
  const shadeFromIdx = extendedShade?.first ?? rthEndIdx;
  const shadeToIdx = extendedShade?.last ?? lastIdx;
  const atClose =
    item.sessionClose ??
    (chartData[rthEndIdx]?.regular != null
      ? chartData[rthEndIdx]!.regular
      : chartData[rthEndIdx]?.extended ?? null);
  const atClosePct = indexValueToDayPct(
    chartUsesIndexedScale ? indexTileChartValue(atClose, priorSessionClose, isIndexedGlanceChartItem(item)) : atClose,
  );
  const extendedPct = item.extendedChangePct ?? indexValueToDayPct(item.extendedLast);

  const renderLastDot = (
    series: "gainFill" | "lossFill",
    props: { index?: number; cx?: number; cy?: number; payload?: TileChartRow },
  ) => {
    const { index, cx, cy, payload } = props;
    if (cx == null || cy == null || payload == null) return null;
    if (index !== lastIdx) return null;
    const value = series === "gainFill" ? payload.gainFill : payload.lossFill;
    if (value == null || !Number.isFinite(value)) return null;
    const dotFill = series === "gainFill" ? UP_STROKE : DOWN_STROKE;
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
                <XAxis dataKey="idx" hide type="number" domain={["dataMin", "dataMax"]} />
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
                    <stop offset="0%" stopColor={UP_STROKE} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={UP_STROKE} stopOpacity={0.03} />
                  </linearGradient>
                  <linearGradient id={gradLossId} x1="0" y1="1" x2="0" y2="0">
                    <stop offset="0%" stopColor={DOWN_STROKE} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={DOWN_STROKE} stopOpacity={0.03} />
                  </linearGradient>
                </defs>
                {chartBaseline != null && Number.isFinite(chartBaseline) ? (
                  <ReferenceLine
                    y={chartBaseline}
                    stroke={REF_LINE}
                    strokeDasharray="4 4"
                    strokeOpacity={0.75}
                  />
                ) : null}
                {showExtendedChart ? (
                  <ReferenceArea
                    x1={baselineChartData[shadeFromIdx]?.idx ?? shadeFromIdx}
                    x2={baselineChartData[shadeToIdx]?.idx ?? shadeToIdx}
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
                      baseValue={chartBaseline}
                      stroke={UP_STROKE}
                      fill={`url(#${gradGainId})`}
                      strokeWidth={2}
                      dot={(props) => renderLastDot("gainFill", props)}
                      isAnimationActive={false}
                      connectNulls
                    />
                    <Area
                      type="linear"
                      dataKey="lossFill"
                      baseValue={chartBaseline}
                      stroke={DOWN_STROKE}
                      fill={`url(#${gradLossId})`}
                      strokeWidth={2}
                      dot={(props) => renderLastDot("lossFill", props)}
                      isAnimationActive={false}
                      connectNulls
                    />
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
            (percentMode
              ? showExtendedChart
                ? "grid-cols-2 sm:grid-cols-4"
                : "grid-cols-2"
              : hasExtended
                ? "grid-cols-2 sm:grid-cols-4"
                : "grid-cols-3")
          }
        >
          {percentMode ? (
            <>
              <div>
                <div className="text-[10px] text-zinc-500 dark:text-zinc-400">Day start</div>
                <div className="text-xs font-medium tabular-nums text-zinc-800 dark:text-zinc-100">0.00%</div>
              </div>
              {showExtendedChart ? (
                <div>
                  <div className="text-[10px] text-zinc-500 dark:text-zinc-400">At close</div>
                  <div className={"text-xs font-medium tabular-nums " + posNegClass(atClosePct)}>
                    {formatGlanceDayPct(atClosePct)}
                  </div>
                </div>
              ) : null}
              {showExtendedChart ? (
                <div>
                  <div className="text-[10px] text-zinc-500 dark:text-zinc-400">Extended</div>
                  <div className={"text-xs font-medium tabular-nums " + posNegClass(extendedPct)}>
                    {formatGlanceDayPct(extendedPct)}
                  </div>
                </div>
              ) : null}
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

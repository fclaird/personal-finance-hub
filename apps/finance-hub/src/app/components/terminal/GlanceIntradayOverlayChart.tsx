"use client";

import { useId, useMemo } from "react";
import {
  Area,
  ComposedChart,
  Legend,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  GLANCE_CHART_BASELINE,
  enrichTileChartRowsForBaselineChart,
  resolveChartReferenceBand,
  tileExtendedShadeStartX,
  type UsMarketGlanceItem,
} from "@/app/components/terminal/MarketGlanceCard";
import {
  buildTileChartRows,
  indexTileChartRows,
  resolvePriorSessionClose,
  type TileChartRow,
} from "@/lib/market/glanceTileChartRows";
import {
  GLANCE_RTH_CLOSE_MIN,
  glanceItemForTileChart,
  glanceShowExtendedChartSegment,
  lastGlanceChartDataTsMs,
  isUsEquityGlanceItem,
  resolveGlanceExtendedShadeX,
  resolveGlanceTileChartAxisDomain,
  type GlanceTileChartWindowCtx,
} from "@/lib/market/glanceTileChartWindow";
import { nyWallTimeMs } from "@/lib/market/futuresGlanceSession";
import {
  enrichOverlayPrimaryLineBands,
  formatGlanceCombinedChartTime,
  indexedGlancePointsFromTile,
  indexedGlanceSeries,
  mergeGlanceSeriesForChart,
  overlayChartYDomain,
  overlaySessionCloseRowIdx,
  overlayShowsExtendedSegment,
  sampleIndexedValueAtTime,
  sessionCloseReferenceY,
  type GlanceChartLine,
  type GlanceCombinedChartRow,
} from "@/lib/terminal/marketGlanceChart";
import { posNegClass } from "@/lib/terminal/colors";

const PCT2 = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const REF_LINE = "#9ca3af";
const UP_STROKE = "#22c55e";
const DOWN_STROKE = "#ef4444";
const NY_TZ = "America/New_York";
const CHART_MARGIN = { top: 4, right: 4, left: 0, bottom: 22 } as const;

/** Dynamic overlay series keys (line ids) sit alongside fixed tile row fields like `segment`. */
interface OverlayChartRow extends TileChartRow {
  [seriesId: string]: number | null | undefined | string;
}

function attachOverlayLinesToTileRows(
  rows: TileChartRow[],
  items: UsMarketGlanceItem[],
  overlayIds: string[],
  windowCtx: GlanceTileChartWindowCtx,
): OverlayChartRow[] {
  const sampled = new Map<string, ReturnType<typeof indexedGlancePointsFromTile>>();
  for (const item of items) {
    if (!overlayIds.includes(item.id)) continue;
    sampled.set(
      item.id,
      isUsEquityGlanceItem(item)
        ? indexedGlancePointsFromTile(item, windowCtx)
        : indexedGlanceSeries(glanceItemForTileChart(item, windowCtx).item),
    );
  }
  return rows.map((row) => {
    const out: OverlayChartRow = { ...row };
    if (row.tsMs == null || !Number.isFinite(row.tsMs)) return out;
    for (const [id, points] of sampled) {
      out[id] = sampleIndexedValueAtTime(points, row.tsMs);
    }
    return out;
  });
}

function resolveSessionCloseChartIdx(rows: TileChartRow[]): number {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if (row.extended != null && row.regular == null && i > 0) return i - 1;
  }
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i]!.regular != null) return i;
  }
  return 0;
}

function buildPrimaryTileOverlayChart(
  primaryItem: UsMarketGlanceItem,
  items: UsMarketGlanceItem[],
  overlayIds: string[],
  windowCtx: GlanceTileChartWindowCtx,
): OverlayChartRow[] {
  const sessionOpen = windowCtx.marketOpen;
  const marketClosed = !sessionOpen;
  const { item: chartItem, omitPriorAnchor } = glanceItemForTileChart(primaryItem, windowCtx);
  const rawRows = buildTileChartRows(chartItem, { omitPriorAnchor });
  const priorSessionClose = resolvePriorSessionClose(primaryItem);
  const chartBaseline =
    priorSessionClose != null && Number.isFinite(priorSessionClose) ? GLANCE_CHART_BASELINE : null;
  const indexedRows = chartBaseline != null ? indexTileChartRows(rawRows, primaryItem) : rawRows;
  const showExtendedChart = glanceShowExtendedChartSegment(chartItem, {
    sessionOpen,
    sessionYmd: windowCtx.sessionYmd,
  });
  let rthEndIdx = 0;
  for (let i = rawRows.length - 1; i >= 0; i--) {
    const row = rawRows[i]!;
    if (row.regular != null || row.extended != null) {
      rthEndIdx = i;
      break;
    }
  }
  const atClose =
    primaryItem.sessionClose ??
    (rawRows[rthEndIdx]?.regular != null
      ? rawRows[rthEndIdx]!.regular
      : (rawRows[rthEndIdx]?.extended ?? null));
  const sessionCloseChartIdx = resolveSessionCloseChartIdx(indexedRows);
  const referenceBand = resolveChartReferenceBand(primaryItem, {
    showExtendedChart,
    extendedPhase: primaryItem.extendedPhase,
    marketClosed,
    atClose,
    priorSessionClose,
    chartBaseline,
    sessionCloseRowIdx: sessionCloseChartIdx,
  });
  const baselineRows = enrichTileChartRowsForBaselineChart(indexedRows, chartBaseline, referenceBand);
  return attachOverlayLinesToTileRows(baselineRows, items, overlayIds, windowCtx);
}

export type GlanceIntradayOverlayChartProps = {
  items: UsMarketGlanceItem[];
  lines: GlanceChartLine[];
  windowCtx: GlanceTileChartWindowCtx;
  primaryLineId?: string;
  chartYDomain?: [number, number];
  height?: number;
  className?: string;
  showLegend?: boolean;
  showFooter?: boolean;
};

export function GlanceIntradayOverlayChart({
  items,
  lines,
  windowCtx,
  primaryLineId,
  chartYDomain: chartYDomainOverride,
  height = 288,
  className,
  showLegend = false,
  showFooter = false,
}: GlanceIntradayOverlayChartProps) {
  const gradGainId = useId().replace(/:/g, "");
  const gradLossId = useId().replace(/:/g, "");
  const gradExtGainId = useId().replace(/:/g, "");
  const gradExtLossId = useId().replace(/:/g, "");
  const lineIds = lines.map((l) => l.id);
  const primaryItem = useMemo(
    () => (primaryLineId ? items.find((i) => i.id === primaryLineId) : undefined),
    [items, primaryLineId],
  );
  const overlayLines = primaryLineId ? lines.filter((line) => line.id !== primaryLineId) : lines;
  const overlayLineIds = overlayLines.map((line) => line.id);
  const usesTilePipeline = primaryLineId != null && primaryItem != null;

  const merged = useMemo(() => mergeGlanceSeriesForChart(items, windowCtx), [items, windowCtx]);
  const chartData = useMemo(() => {
    if (usesTilePipeline && primaryItem) {
      return buildPrimaryTileOverlayChart(primaryItem, items, overlayLineIds, windowCtx);
    }
    if (!primaryLineId) return merged;
    return enrichOverlayPrimaryLineBands(merged, primaryLineId, windowCtx, primaryItem);
  }, [usesTilePipeline, primaryItem, items, overlayLineIds, windowCtx, primaryLineId, merged]);

  const yDomain = useMemo(
    () =>
      chartYDomainOverride ??
      overlayChartYDomain(items, windowCtx, chartData, lineIds),
    [chartYDomainOverride, items, windowCtx, chartData, lineIds],
  );
  const hasTimestamps = useMemo(() => chartData.some((row) => row.tsMs != null), [chartData]);
  const chartAxisDomain = useMemo(() => {
    const lastTs = lastGlanceChartDataTsMs(chartData);
    const axisItem = usesTilePipeline && primaryItem ? primaryItem : items;
    return resolveGlanceTileChartAxisDomain(windowCtx, axisItem, lastTs);
  }, [windowCtx, items, chartData, usesTilePipeline, primaryItem]);
  const useFixedTimeAxis = chartAxisDomain != null && hasTimestamps;

  /** Recharts needs a timestamp on every row when the x-axis is wall-clock; gap rows stay in chartData for band logic only. */
  const plotData = useMemo(() => {
    if (!useFixedTimeAxis) return chartData;
    return chartData.filter((row) => row.tsMs != null && Number.isFinite(row.tsMs));
  }, [chartData, useFixedTimeAxis]);

  const showExtendedChart = useMemo(() => {
    if (usesTilePipeline && primaryItem) {
      return glanceShowExtendedChartSegment(glanceItemForTileChart(primaryItem, windowCtx).item, {
        sessionOpen: windowCtx.marketOpen,
        sessionYmd: windowCtx.sessionYmd,
      });
    }
    return overlayShowsExtendedSegment(items, windowCtx);
  }, [usesTilePipeline, primaryItem, items, windowCtx]);

  const priorReferenceY = GLANCE_CHART_BASELINE;
  const sessionCloseRefY =
    !windowCtx.marketOpen && primaryItem ? sessionCloseReferenceY(primaryItem) : null;
  const sessionCloseRowIdx = useMemo(() => {
    if (usesTilePipeline) return resolveSessionCloseChartIdx(chartData as TileChartRow[]);
    return overlaySessionCloseRowIdx(chartData as GlanceCombinedChartRow[], windowCtx);
  }, [usesTilePipeline, chartData, windowCtx]);

  const lastIdx = Math.max(0, chartData.length - 1);
  const shadeBounds = useMemo(() => {
    if (!showExtendedChart || !chartAxisDomain || chartData.length < 2) return null;
    const lastTs = lastGlanceChartDataTsMs(chartData);
    return resolveGlanceExtendedShadeX(windowCtx, chartAxisDomain, lastTs);
  }, [showExtendedChart, chartAxisDomain, windowCtx, chartData]);

  const extendedShade = useMemo(() => {
    if (!usesTilePipeline || !showExtendedChart) return null;
    let first = -1;
    let last = -1;
    const tileRows = chartData as TileChartRow[];
    for (let i = 0; i < tileRows.length; i++) {
      if (tileRows[i]!.extended != null) {
        if (first < 0) first = i;
        last = i;
      }
    }
    if (first < 0 || last < 0) return null;
    return { first, last };
  }, [usesTilePipeline, showExtendedChart, chartData]);

  const shadeFromIdx =
    !windowCtx.marketOpen && showExtendedChart
      ? sessionCloseRowIdx
      : (extendedShade?.first ?? sessionCloseRowIdx);
  const shadeToIdx = extendedShade?.last ?? lastIdx;
  const plotLastIdx = Math.max(0, plotData.length - 1);

  const renderLastDot = (
    series: "gainStroke" | "lossStroke" | "extGainStroke" | "extLossStroke",
    props: { index?: number; cx?: number; cy?: number; payload?: Record<string, unknown> },
  ) => {
    const { index, cx, cy, payload } = props;
    if (cx == null || cy == null || payload == null) return null;
    if (index !== plotLastIdx) return null;
    const lastRow = plotData[plotLastIdx];
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
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    const dotFill = series === "gainStroke" || series === "extGainStroke" ? UP_STROKE : DOWN_STROKE;
    return (
      <circle cx={cx} cy={cy} r={3.5} fill={dotFill} stroke="#fff" strokeWidth={1.5} className="dark:stroke-zinc-900" />
    );
  };

  if (plotData.length < 2 || lines.length === 0) {
    return null;
  }

  const sessionCloseBoundaryMs =
    !windowCtx.marketOpen && windowCtx.sessionYmd
      ? nyWallTimeMs(windowCtx.sessionYmd, GLANCE_RTH_CLOSE_MIN)
      : null;
  const lastRowTs = plotData[plotLastIdx]?.tsMs ?? null;
  const firstChartX = useFixedTimeAxis ? chartAxisDomain!.startMs : (plotData[0]?.tsMs ?? plotData[0]?.idx ?? 0);
  const lastChartX = useFixedTimeAxis
    ? (lastRowTs ?? chartAxisDomain!.endMs)
    : (plotData[plotLastIdx]?.tsMs ?? plotData[plotLastIdx]?.idx ?? plotLastIdx);
  const closeChartX = useFixedTimeAxis
    ? (chartData[sessionCloseRowIdx]?.tsMs ?? sessionCloseBoundaryMs ?? sessionCloseRowIdx)
    : (chartData[sessionCloseRowIdx]?.tsMs ?? sessionCloseRowIdx);
  const priorRefEndX =
    sessionCloseRefY != null && showExtendedChart ? closeChartX : lastChartX;
  const shadeAreaX1 =
    shadeBounds?.fromMs ??
    (usesTilePipeline
      ? tileExtendedShadeStartX(chartData as TileChartRow[], shadeFromIdx)
      : shadeFromIdx);
  const shadeAreaX2 =
    shadeBounds?.toMs ??
    chartData[shadeToIdx]?.tsMs ??
    chartData[shadeToIdx]?.idx ??
    shadeToIdx;

  return (
    <>
      <div className={className ?? "h-72 w-full min-w-0"} style={className ? undefined : { height }}>
        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={height}>
          <ComposedChart
            data={plotData}
            margin={useFixedTimeAxis ? CHART_MARGIN : { top: 8, right: 12, left: 0, bottom: 0 }}
          >
            {useFixedTimeAxis ? (
              <XAxis
                dataKey="tsMs"
                type="number"
                scale="linear"
                domain={[chartAxisDomain!.startMs, chartAxisDomain!.endMs]}
                allowDataOverflow
                tickFormatter={(ts) =>
                  new Intl.DateTimeFormat("en-US", {
                    hour: "numeric",
                    minute: "2-digit",
                    timeZone: NY_TZ,
                  }).format(new Date(Number(ts)))
                }
                tick={{ fontSize: 10 }}
                minTickGap={48}
                className="fill-zinc-500 dark:fill-zinc-400"
              />
            ) : hasTimestamps ? (
              <XAxis
                dataKey="tsMs"
                type="number"
                domain={["dataMin", "dataMax"]}
                tickFormatter={(ts) =>
                  new Intl.DateTimeFormat("en-US", {
                    hour: "numeric",
                    minute: "2-digit",
                    timeZone: NY_TZ,
                  }).format(new Date(Number(ts)))
                }
                tick={{ fontSize: 10 }}
                minTickGap={48}
                className="fill-zinc-500 dark:fill-zinc-400"
              />
            ) : (
              <XAxis dataKey="idx" hide />
            )}
            <YAxis hide domain={yDomain} />
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
            {showExtendedChart ? (
              <ReferenceArea
                x1={shadeAreaX1}
                x2={shadeAreaX2}
                fill="#94a3b8"
                fillOpacity={0.22}
                ifOverflow="extendDomain"
              />
            ) : null}
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
            {sessionCloseRefY != null && showExtendedChart ? (
              <ReferenceLine
                segment={[
                  { x: closeChartX, y: sessionCloseRefY },
                  { x: lastChartX, y: sessionCloseRefY },
                ]}
                stroke={REF_LINE}
                strokeDasharray="4 4"
                strokeOpacity={0.75}
                ifOverflow="extendDomain"
              />
            ) : null}
            {overlayLines.map((line) => (
              <Line
                key={line.id}
                type="linear"
                dataKey={line.id}
                name={line.id}
                stroke={line.color}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
                connectNulls={false}
              />
            ))}
            <Tooltip
              formatter={(value, name) => {
                const num = typeof value === "number" ? value : Number(value);
                if (!Number.isFinite(num)) return ["—", String(name)];
                const line = lines.find((l) => l.id === name);
                const pct = num - GLANCE_CHART_BASELINE;
                return [`${pct >= 0 ? "+" : ""}${PCT2.format(pct)}%`, line?.label ?? String(name)];
              }}
              labelFormatter={(_, payload) => {
                const tsMs = payload?.[0]?.payload?.tsMs;
                if (typeof tsMs === "number" && Number.isFinite(tsMs)) {
                  return formatGlanceCombinedChartTime(tsMs);
                }
                return "Session";
              }}
              cursor={{ stroke: REF_LINE, strokeWidth: 1, strokeDasharray: "3 3" }}
              contentStyle={{ fontSize: 12 }}
            />
            {showLegend ? (
              <Legend
                formatter={(value: string) => lines.find((l) => l.id === value)?.label ?? value}
                wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
              />
            ) : null}
            {primaryLineId ? (
              <>
                <Area
                  type="linear"
                  dataKey="gainFill"
                  baseValue={priorReferenceY}
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
                  baseValue={priorReferenceY}
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
                {sessionCloseRefY != null && showExtendedChart ? (
                  <>
                    <Area
                      type="linear"
                      dataKey="extGainFill"
                      baseValue={sessionCloseRefY}
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
                      baseValue={sessionCloseRefY}
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
            ) : null}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {showFooter ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => {
            const pct = item.changePct;
            const line = lines.find((l) => l.id === item.id);
            return (
              <div key={item.id} className="flex items-center gap-2 text-xs">
                <span
                  className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: line?.color ?? "#71717a" }}
                  aria-hidden
                />
                <span className="font-medium text-zinc-700 dark:text-zinc-200">{item.label}</span>
                <span className={"ml-auto tabular-nums " + posNegClass(pct)}>
                  {pct == null ? "—" : `${pct >= 0 ? "+" : ""}${PCT2.format(pct)}%`}
                </span>
              </div>
            );
          })}
        </div>
      ) : null}
    </>
  );
}

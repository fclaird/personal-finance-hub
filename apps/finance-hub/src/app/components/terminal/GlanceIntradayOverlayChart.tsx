"use client";

import { useId, useMemo } from "react";
import {
  Area,
  CartesianGrid,
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

import { GLANCE_CHART_BASELINE } from "@/app/components/terminal/MarketGlanceCard";
import type { UsMarketGlanceItem } from "@/app/components/terminal/MarketGlanceCard";
import {
  lastGlanceChartDataTsMs,
  resolveGlanceExtendedShadeX,
  resolveGlanceTileChartAxisDomain,
  type GlanceTileChartWindowCtx,
} from "@/lib/market/glanceTileChartWindow";
import {
  enrichOverlayPrimaryLineBands,
  extendedOverlayShadeRange,
  formatGlanceCombinedChartTime,
  glanceChartYDomain,
  mergeGlanceSeriesForChart,
  overlaySessionCloseBoundaryMs,
  overlayExtendedShadeStartX,
  priorCloseReferenceEndIdx,
  sessionCloseReferenceY,
  type GlanceChartLine,
} from "@/lib/terminal/marketGlanceChart";
import { posNegClass } from "@/lib/terminal/colors";

const PCT2 = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const REF_LINE = "#9ca3af";
const UP_STROKE = "#22c55e";
const DOWN_STROKE = "#ef4444";
const NY_TZ = "America/New_York";

export type GlanceIntradayOverlayChartProps = {
  items: UsMarketGlanceItem[];
  lines: GlanceChartLine[];
  windowCtx: GlanceTileChartWindowCtx;
  primaryLineId?: string;
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
  const merged = useMemo(() => mergeGlanceSeriesForChart(items, windowCtx), [items, windowCtx]);
  const primaryItem = useMemo(
    () => (primaryLineId ? items.find((i) => i.id === primaryLineId) : undefined),
    [items, primaryLineId],
  );
  const chartData = useMemo(() => {
    if (!primaryLineId) return merged;
    return enrichOverlayPrimaryLineBands(merged, primaryLineId, windowCtx, primaryItem);
  }, [merged, primaryLineId, windowCtx, primaryItem]);
  const yDomain = useMemo(
    () => glanceChartYDomain(chartData, lineIds, items, windowCtx),
    [chartData, lineIds, items, windowCtx],
  );
  const hasTimestamps = useMemo(() => chartData.some((row) => row.tsMs != null), [chartData]);
  const chartAxisDomain = useMemo(() => {
    const lastTs = lastGlanceChartDataTsMs(chartData);
    return resolveGlanceTileChartAxisDomain(windowCtx, undefined, lastTs);
  }, [windowCtx, chartData]);
  const useFixedTimeAxis = chartAxisDomain != null && hasTimestamps;
  const shadeRange = useMemo(
    () => extendedOverlayShadeRange(chartData, windowCtx, items),
    [chartData, windowCtx, items],
  );
  const priorRefEndIdx = useMemo(() => priorCloseReferenceEndIdx(chartData, windowCtx), [chartData, windowCtx]);
  const lastIdx = Math.max(0, chartData.length - 1);
  const shadeBounds = useMemo(() => {
    if (!shadeRange || !chartAxisDomain || chartData.length < 2) return null;
    const lastTs = chartData[lastIdx]?.tsMs ?? null;
    return resolveGlanceExtendedShadeX(windowCtx, chartAxisDomain, lastTs);
  }, [shadeRange, chartAxisDomain, windowCtx, chartData, lastIdx]);
  const sessionCloseY = primaryItem ? sessionCloseReferenceY(primaryItem) : null;
  const overlayLines = primaryLineId ? lines.filter((line) => line.id !== primaryLineId) : lines;

  const renderLastDot = (
    series: "gainStroke" | "lossStroke" | "extGainStroke" | "extLossStroke",
    props: { index?: number; cx?: number; cy?: number; payload?: Record<string, unknown> },
  ) => {
    const { index, cx, cy, payload } = props;
    if (cx == null || cy == null || payload == null) return null;
    if (index !== lastIdx) return null;
    const lastRow = chartData[lastIdx];
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

  if (chartData.length < 2 || lines.length === 0) {
    return null;
  }

  const xAt = (idx: number) => chartData[idx]?.tsMs ?? chartData[idx]?.idx ?? idx;
  const sessionCloseBoundaryX = overlaySessionCloseBoundaryMs(windowCtx);
  const shadeStartX = overlayExtendedShadeStartX(chartData, windowCtx);
  const firstX = useFixedTimeAxis ? chartAxisDomain!.startMs : xAt(0);
  const priorRefEndX = sessionCloseBoundaryX ?? xAt(priorRefEndIdx);
  const lastX = useFixedTimeAxis
    ? (chartData[lastIdx]?.tsMs ?? chartAxisDomain!.endMs)
    : xAt(lastIdx);
  const shadeFromX =
    shadeBounds?.fromMs ??
    (shadeRange != null ? (shadeStartX ?? sessionCloseBoundaryX ?? xAt(shadeRange.fromIdx)) : null);
  const shadeToX = shadeBounds?.toMs ?? (shadeRange ? xAt(shadeRange.toIdx) : null);
  const closeX = sessionCloseBoundaryX ?? priorRefEndX;

  return (
    <>
      <div className={className ?? "h-72 w-full min-w-0"} style={className ? undefined : { height }}>
        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={height}>
          <ComposedChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: useFixedTimeAxis ? 22 : 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-zinc-200 dark:stroke-zinc-700" />
            {useFixedTimeAxis ? (
              <XAxis
                dataKey="tsMs"
                type="number"
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
            <YAxis
              domain={yDomain}
              tickFormatter={(v) => `${(Number(v) - GLANCE_CHART_BASELINE).toFixed(1)}%`}
              width={44}
              tick={{ fontSize: 10 }}
              className="fill-zinc-500 dark:fill-zinc-400"
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
            {shadeFromX != null && shadeToX != null ? (
              <ReferenceArea
                x1={shadeFromX}
                x2={shadeToX}
                fill="#94a3b8"
                fillOpacity={0.22}
                ifOverflow="extendDomain"
              />
            ) : null}
            <ReferenceLine
              segment={[
                { x: firstX, y: GLANCE_CHART_BASELINE },
                { x: priorRefEndX, y: GLANCE_CHART_BASELINE },
              ]}
              stroke={REF_LINE}
              strokeDasharray="4 4"
              strokeOpacity={0.75}
              ifOverflow="extendDomain"
            />
            {!windowCtx.marketOpen && sessionCloseY != null && sessionCloseY !== GLANCE_CHART_BASELINE ? (
              <ReferenceLine
                segment={[
                  { x: closeX, y: sessionCloseY },
                  { x: lastX, y: sessionCloseY },
                ]}
                stroke={REF_LINE}
                strokeDasharray="4 4"
                strokeOpacity={0.75}
                ifOverflow="extendDomain"
              />
            ) : null}
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
                  baseValue={GLANCE_CHART_BASELINE}
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
                  baseValue={GLANCE_CHART_BASELINE}
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
                {!windowCtx.marketOpen && sessionCloseY != null ? (
                  <>
                    <Area
                      type="linear"
                      dataKey="extGainFill"
                      baseValue={sessionCloseY}
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
                      baseValue={sessionCloseY}
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
                connectNulls
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {showFooter ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
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

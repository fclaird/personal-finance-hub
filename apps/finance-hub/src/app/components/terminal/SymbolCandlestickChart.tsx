"use client";

import { useMemo } from "react";
import {
  Brush,
  ComposedChart,
  Customized,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { posNegClass } from "@/lib/terminal/colors";
import {
  candleColor,
  type CandleChartRow,
  priceYDomain,
  pctYDomain,
} from "@/lib/terminal/candlestickRender";
import type { VisibleTimeRange } from "@/hooks/useChartTimeRange";

const PCT2 = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const USD2 = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const NY_TZ = "America/New_York";
const CHART_MARGIN = { top: 8, right: 48, left: 4, bottom: 28 } as const;
const QQQ_COLOR = "#0891b2";
const SPY_COLOR = "#16a34a";

function formatChartTime(tsMs: number, window: string): string {
  const d = new Date(tsMs);
  if (window === "1D" || window === "5D") {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: NY_TZ,
    }).format(d);
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: window === "5Y" || window === "3Y" ? "numeric" : undefined,
    timeZone: NY_TZ,
  }).format(d);
}

type CandleLayerProps = {
  xAxisMap?: Record<string, { scale: (v: number) => number; x?: number; width?: number }>;
  yAxisMap?: Record<string, { scale: (v: number) => number }>;
  offset?: { left?: number; top?: number; width?: number; height?: number };
  data?: CandleChartRow[];
  candleWidth?: number;
};

function CandlestickLayer({ xAxisMap, yAxisMap, offset, data, candleWidth = 6 }: CandleLayerProps) {
  const xAxis = xAxisMap ? Object.values(xAxisMap)[0] : undefined;
  const yAxis = yAxisMap?.price ?? yAxisMap?.[0] ?? (yAxisMap ? Object.values(yAxisMap)[0] : undefined);
  if (!xAxis?.scale || !yAxis?.scale || !data?.length || !offset) return null;

  const xScale = xAxis.scale.bind(xAxis);
  const yScale = yAxis.scale.bind(yAxis);
  const half = Math.max(2, candleWidth / 2);

  return (
    <g className="candlestick-layer">
      {data.map((c) => {
        const cx = xScale(c.tsMs) + (offset.left ?? 0);
        const yHigh = yScale(c.high) + (offset.top ?? 0);
        const yLow = yScale(c.low) + (offset.top ?? 0);
        const yOpen = yScale(c.open) + (offset.top ?? 0);
        const yClose = yScale(c.close) + (offset.top ?? 0);
        const color = candleColor(c.open, c.close);
        const bodyTop = Math.min(yOpen, yClose);
        const bodyBottom = Math.max(yOpen, yClose);
        const bodyH = Math.max(bodyBottom - bodyTop, 1);
        return (
          <g key={c.tsMs}>
            <line x1={cx} x2={cx} y1={yHigh} y2={yLow} stroke={color} strokeWidth={1} />
            <rect x={cx - half} y={bodyTop} width={half * 2} height={bodyH} fill={color} stroke={color} />
          </g>
        );
      })}
    </g>
  );
}

function CandleTooltip({
  active,
  payload,
  windowKey,
  symbolLabel,
}: {
  active?: boolean;
  payload?: Array<{ payload?: CandleChartRow }>;
  windowKey: string;
  symbolLabel: string;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;

  return (
    <div className="rounded-lg border border-zinc-300 bg-white px-2.5 py-2 text-[11px] shadow-md dark:border-white/15 dark:bg-zinc-950">
      <div className="font-medium text-zinc-800 dark:text-zinc-100">{formatChartTime(row.tsMs, windowKey)}</div>
      <div className="mt-1 font-semibold text-zinc-900 dark:text-zinc-50">{symbolLabel}</div>
      <div className="mt-1 space-y-0.5 tabular-nums text-zinc-800 dark:text-zinc-200">
        <div>O {USD2.format(row.open)}</div>
        <div>H {USD2.format(row.high)}</div>
        <div>L {USD2.format(row.low)}</div>
        <div>C {USD2.format(row.close)}</div>
      </div>
      {row.qqqPct != null && Number.isFinite(row.qqqPct) ? (
        <div className={"mt-1 tabular-nums font-medium " + posNegClass(row.qqqPct)}>
          QQQ {row.qqqPct >= 0 ? "+" : ""}
          {PCT2.format(row.qqqPct)}%
        </div>
      ) : null}
      {row.spyPct != null && Number.isFinite(row.spyPct) ? (
        <div className={"tabular-nums font-medium " + posNegClass(row.spyPct)}>
          SPY {row.spyPct >= 0 ? "+" : ""}
          {PCT2.format(row.spyPct)}%
        </div>
      ) : null}
    </div>
  );
}

export type SymbolCandlestickChartProps = {
  data: CandleChartRow[];
  windowKey: string;
  symbolLabel: string;
  visibleRange: VisibleTimeRange | null;
  onVisibleRangeChange?: (range: VisibleTimeRange) => void;
  onWheelPan?: (e: React.WheelEvent) => void;
  brushData?: CandleChartRow[];
  height?: number;
  className?: string;
  aggregatedNote?: string;
};

export function SymbolCandlestickChart({
  data,
  windowKey,
  symbolLabel,
  visibleRange,
  onVisibleRangeChange,
  onWheelPan,
  brushData,
  height = 288,
  className,
  aggregatedNote,
}: SymbolCandlestickChartProps) {
  const visibleData = useMemo(() => {
    if (!visibleRange) return data;
    return data.filter((c) => c.tsMs >= visibleRange.fromMs && c.tsMs <= visibleRange.toMs);
  }, [data, visibleRange]);

  const priceDomain = useMemo(() => priceYDomain(visibleData), [visibleData]);
  const pctDomain = useMemo(() => pctYDomain(visibleData), [visibleData]);

  const xDomain = useMemo((): [number, number] => {
    if (visibleRange) return [visibleRange.fromMs, visibleRange.toMs];
    if (visibleData.length < 2) return [0, 1];
    return [visibleData[0]!.tsMs, visibleData[visibleData.length - 1]!.tsMs];
  }, [visibleRange, visibleData]);

  const candleWidth = useMemo(() => {
    const n = Math.max(visibleData.length, 1);
    return Math.min(14, Math.max(3, Math.floor(280 / n)));
  }, [visibleData.length]);

  const brushSource = brushData ?? data;

  if (visibleData.length < 1) {
    return <div className="text-sm text-zinc-600 dark:text-zinc-400">No candle data for this range.</div>;
  }

  return (
    <div className={className ?? "w-full min-w-0"} style={{ height }} onWheel={onWheelPan}>
      {aggregatedNote ? (
        <p className="mb-1 text-[10px] text-zinc-500 dark:text-zinc-400">{aggregatedNote}</p>
      ) : null}
      <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={height - (aggregatedNote ? 16 : 0)}>
        <ComposedChart data={visibleData} margin={CHART_MARGIN}>
          <XAxis
            dataKey="tsMs"
            type="number"
            domain={xDomain}
            allowDataOverflow
            tickFormatter={(ts) =>
              new Intl.DateTimeFormat("en-US", {
                hour: windowKey === "1D" || windowKey === "5D" ? "numeric" : undefined,
                month: windowKey === "1D" || windowKey === "5D" ? undefined : "short",
                day: windowKey === "1D" || windowKey === "5D" ? undefined : "numeric",
                minute: windowKey === "1D" || windowKey === "5D" ? "2-digit" : undefined,
                timeZone: NY_TZ,
              }).format(new Date(Number(ts)))
            }
            tick={{ fontSize: 10 }}
            minTickGap={40}
            className="fill-zinc-500 dark:fill-zinc-400"
          />
          <YAxis yAxisId="price" domain={priceDomain} tick={{ fontSize: 10 }} width={52} />
          <YAxis
            yAxisId="pct"
            orientation="right"
            domain={pctDomain}
            tickFormatter={(v) => `${Number(v).toFixed(1)}%`}
            tick={{ fontSize: 10 }}
            width={44}
          />
          <Tooltip
            content={<CandleTooltip windowKey={windowKey} symbolLabel={symbolLabel} />}
            cursor={{ stroke: "#9ca3af", strokeDasharray: "3 3" }}
          />
          <Line
            yAxisId="pct"
            type="linear"
            dataKey="qqqPct"
            stroke={QQQ_COLOR}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
            connectNulls
          />
          <Line
            yAxisId="pct"
            type="linear"
            dataKey="spyPct"
            stroke={SPY_COLOR}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
            connectNulls
          />
          <Customized
            component={(props: CandleLayerProps) => (
              <CandlestickLayer {...props} data={visibleData} candleWidth={candleWidth} />
            )}
          />
          {brushSource.length >= 4 && onVisibleRangeChange ? (
            <Brush
              dataKey="tsMs"
              height={22}
              stroke="#9ca3af"
              travellerWidth={8}
              startIndex={brushSource.findIndex((c) => c.tsMs >= (visibleRange?.fromMs ?? brushSource[0]!.tsMs))}
              endIndex={Math.max(
                0,
                brushSource.findIndex((c) => c.tsMs >= (visibleRange?.toMs ?? brushSource[brushSource.length - 1]!.tsMs)),
              )}
              onChange={(range) => {
                if (range == null || typeof range !== "object") return;
                const r = range as { startIndex?: number; endIndex?: number };
                const start = r.startIndex ?? 0;
                const end = r.endIndex ?? brushSource.length - 1;
                const from = brushSource[start];
                const to = brushSource[end];
                if (from && to) onVisibleRangeChange({ fromMs: from.tsMs, toMs: to.tsMs });
              }}
            />
          ) : null}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

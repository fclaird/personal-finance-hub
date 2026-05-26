"use client";

import { useMemo } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  formatGlanceCombinedChartTime,
  glanceChartYDomain,
  mergeGlanceSeriesForChart,
  resolveGlanceChartLines,
} from "@/lib/terminal/marketGlanceChart";
import { posNegClass } from "@/lib/terminal/colors";

import type { UsMarketGlanceItem } from "./MarketGlanceCard";

const PCT2 = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function MarketGlanceCombinedChart({ items }: { items: UsMarketGlanceItem[] }) {
  const lines = useMemo(() => resolveGlanceChartLines(items), [items]);

  const chartData = useMemo(() => mergeGlanceSeriesForChart(items), [items]);
  const yDomain = useMemo(() => glanceChartYDomain(chartData, lines.map((l) => l.id)), [chartData, lines]);
  const hasTimestamps = useMemo(() => chartData.some((row) => row.tsMs != null), [chartData]);

  if (chartData.length < 2 || lines.length === 0) {
    return <div className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">No intraday data for combined chart.</div>;
  }

  return (
    <div className="mt-3 rounded-xl border border-zinc-300 bg-zinc-50 p-3 dark:border-white/15 dark:bg-zinc-900/80">
      <div className="h-52 w-full min-w-0">
        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={208}>
          <LineChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: hasTimestamps ? 22 : 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-zinc-200 dark:stroke-zinc-700" />
            {hasTimestamps ? (
              <XAxis
                dataKey="tsMs"
                type="number"
                domain={["dataMin", "dataMax"]}
                tickFormatter={(ts) =>
                  new Intl.DateTimeFormat("en-US", {
                    hour: "numeric",
                    minute: "2-digit",
                    timeZone: "America/New_York",
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
              tickFormatter={(v) => `${Number(v).toFixed(1)}`}
              width={44}
              tick={{ fontSize: 10 }}
              className="fill-zinc-500 dark:fill-zinc-400"
            />
            <ReferenceLine
              y={100}
              stroke="currentColor"
              strokeDasharray="4 4"
              className="text-zinc-400 dark:text-zinc-500"
              strokeOpacity={0.7}
            />
            <Tooltip
              formatter={(value, name) => {
                const num = typeof value === "number" ? value : Number(value);
                if (!Number.isFinite(num)) return ["—", String(name)];
                const line = lines.find((l) => l.id === name);
                const pct = num - 100;
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
            <Legend
              formatter={(value: string) => lines.find((l) => l.id === value)?.label ?? value}
              wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
            />
            {lines.map((line) => (
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
          </LineChart>
        </ResponsiveContainer>
      </div>
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
    </div>
  );
}

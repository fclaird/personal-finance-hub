"use client";

import { Area, AreaChart, ReferenceLine, ResponsiveContainer, YAxis } from "recharts";

import { posNegClass } from "@/lib/terminal/colors";

export type UsMarketGlanceItem = {
  id: string;
  label: string;
  symbol: string;
  last: number | null;
  change: number | null;
  changePct: number | null;
  previousClose: number | null;
  series: Array<{ idx: number; close: number }>;
};

const PCT2 = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function sparklineYDomain(series: Array<{ close: number }>, previousClose: number | null): [number, number] {
  const vals = series.map((p) => p.close);
  if (previousClose != null && Number.isFinite(previousClose)) vals.push(previousClose);
  if (vals.length === 0) return [0, 1];
  let min = Math.min(...vals);
  let max = Math.max(...vals);
  if (min === max) {
    const bump = Math.max(Math.abs(min) * 0.001, 0.05);
    min -= bump;
    max += bump;
  } else {
    const pad = Math.max((max - min) * 0.12, 0.02);
    min -= pad;
    max += pad;
  }
  return [min, max];
}

export function MarketGlanceCard({ item }: { item: UsMarketGlanceItem }) {
  const pct = item.changePct;
  const up = pct == null ? true : pct >= 0;
  const stroke = up ? "#22c55e" : "#ef4444";
  const gradId = `usmk-${item.id}`;
  const chartData = item.series;
  const prev = item.previousClose;
  const yDomain = sparklineYDomain(chartData, prev);

  return (
    <div className="min-w-[11.5rem] flex-1 rounded-xl border border-zinc-300 bg-zinc-50 p-3 dark:border-white/15 dark:bg-zinc-900/80">
      <div className="text-xs font-medium text-zinc-700 dark:text-zinc-200">{item.label}</div>
      {chartData.length >= 2 ? (
        <div className="mt-1 h-14 w-full min-w-0">
          <ResponsiveContainer width="100%" height="100%" minWidth={64} minHeight={56}>
            <AreaChart data={chartData} margin={{ top: 2, right: 2, left: 0, bottom: 0 }}>
              <YAxis hide domain={yDomain} />
              <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={stroke} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={stroke} stopOpacity={0} />
                </linearGradient>
              </defs>
              {prev != null && Number.isFinite(prev) ? (
                <ReferenceLine
                  y={prev}
                  stroke="currentColor"
                  strokeDasharray="3 3"
                  className="text-zinc-400 dark:text-zinc-500"
                  strokeOpacity={0.55}
                />
              ) : null}
              <Area
                type="linear"
                dataKey="close"
                dot={false}
                stroke={stroke}
                fill={`url(#${gradId})`}
                strokeWidth={1.5}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="mt-1 h-14 text-[10px] text-zinc-500">No intraday data</div>
      )}
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0">
        <span className="text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
          {item.last == null ? "—" : item.last.toFixed(2)}
        </span>
        {item.change != null ? (
          <span className={"text-xs tabular-nums " + posNegClass(item.change)}>
            {item.change >= 0 ? "+" : ""}
            {item.change.toFixed(2)}
          </span>
        ) : null}
      </div>
      <div className={"text-xs tabular-nums " + posNegClass(pct)}>
        {pct == null ? "—" : `${pct >= 0 ? "+" : ""}${PCT2.format(pct)}%`}
      </div>
    </div>
  );
}

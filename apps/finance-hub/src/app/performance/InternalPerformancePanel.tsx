"use client";

import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { filletLinearCurve } from "@/lib/charts/curveFilletLinear";
import { formatDisplayDate } from "@/lib/formatDate";
import { PORTFOLIO_LINE_COLOR } from "@/lib/market/performanceBenchmarks";

export type InternalSymbol = {
  symbol: string;
  reason: "shares" | "synthetic" | "both";
  color: string;
  defaultOn?: boolean;
};

export type InternalChartRow = {
  date: string;
  seq_index: number;
  portfolio: number | null;
  positions: Record<string, number | null>;
  stocks: Record<string, number | null>;
};

function formatPct(v: number) {
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}%`;
}

export function InternalPerformancePanel({
  loading,
  error,
  symbols,
  rows,
}: {
  loading: boolean;
  error: string | null;
  symbols: InternalSymbol[];
  rows: InternalChartRow[];
}) {
  const [stockOff, setStockOff] = useState<string[]>([]);
  const symbolKey = symbols.map((symbol) => `${symbol.symbol}:${symbol.defaultOn === false ? 0 : 1}`).join("|");
  const [hiddenState, setHiddenState] = useState<{ key: string; hidden: string[] } | null>(null);
  const hiddenList =
    hiddenState?.key === symbolKey
      ? hiddenState.hidden
      : symbols.filter((symbol) => symbol.defaultOn === false).map((symbol) => symbol.symbol);
  const hiddenSet = useMemo(() => new Set(hiddenList), [hiddenList]);
  const stockOffSet = useMemo(() => new Set(stockOff), [stockOff]);

  function toggleSymbol(symbol: string) {
    const next = hiddenList.includes(symbol) ? hiddenList.filter((item) => item !== symbol) : [...hiddenList, symbol];
    setHiddenState({ key: symbolKey, hidden: next });
  }

  function toggleStock(symbol: string) {
    setStockOff((list) => (list.includes(symbol) ? list.filter((item) => item !== symbol) : [...list, symbol]));
  }

  const chartData = useMemo(() => {
    return rows.map((row) => {
      const point: Record<string, string | number | null> = {
        asOfLabel: formatDisplayDate(row.date, { fallback: row.date }),
        seqIndex: row.seq_index,
        Portfolio: row.portfolio,
      };
      for (const symbol of symbols) {
        point[`p:${symbol.symbol}`] = hiddenSet.has(symbol.symbol) ? null : (row.positions[symbol.symbol] ?? null);
        point[`s:${symbol.symbol}`] = stockOffSet.has(symbol.symbol) ? null : (row.stocks[symbol.symbol] ?? null);
      }
      return point;
    });
  }, [hiddenSet, rows, stockOffSet, symbols]);

  const seqLabelByIndex = useMemo(() => {
    const labels = new Map<number, string>();
    for (const row of chartData) labels.set(Number(row.seqIndex), String(row.asOfLabel));
    return labels;
  }, [chartData]);

  if (loading) return <div className="text-sm text-zinc-600 dark:text-zinc-400">Loading chart…</div>;
  if (error) {
    return (
      <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">{error}</div>
    );
  }
  if (chartData.length < 2) {
    return (
      <div className="text-sm text-zinc-600 dark:text-zinc-400">
        Not enough aligned data yet. Connect Schwab and run syncs — the chart uses the same trading days as portfolio
        history.
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm" role="group" aria-label="Positions">
        <div className="inline-flex items-center gap-2 px-1 text-zinc-700 dark:text-zinc-200">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: PORTFOLIO_LINE_COLOR }} />
          <span style={{ color: PORTFOLIO_LINE_COLOR }}>Portfolio</span>
        </div>
        {symbols.map((symbol) => {
          const on = !hiddenSet.has(symbol.symbol);
          const stockOn = !stockOffSet.has(symbol.symbol);
          return (
            <span key={symbol.symbol} className="inline-flex items-center gap-1">
              <button
                type="button"
                aria-pressed={on}
                onClick={() => toggleSymbol(symbol.symbol)}
                className={
                  "inline-flex items-center gap-2 rounded-full border bg-white/80 px-2.5 py-1 text-sm font-medium dark:bg-zinc-950/40 " +
                  (on ? "" : "opacity-45")
                }
                style={{ color: symbol.color, borderColor: symbol.color }}
              >
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={
                    on
                      ? { backgroundColor: symbol.color }
                      : { backgroundColor: "transparent", boxShadow: `inset 0 0 0 1.5px ${symbol.color}` }
                  }
                />
                {symbol.symbol}
              </button>
              <button
                type="button"
                aria-pressed={stockOn}
                onClick={() => toggleStock(symbol.symbol)}
                className={
                  "inline-flex items-center gap-2 rounded-full border border-dashed bg-white/80 px-2.5 py-1 text-sm font-medium dark:bg-zinc-950/40 " +
                  (stockOn ? "" : "opacity-45")
                }
                style={{ color: symbol.color, borderColor: symbol.color }}
              >
                {symbol.symbol} stock
              </button>
            </span>
          );
        })}
        {symbols.length === 0 ? (
          <span className="text-xs text-zinc-600 dark:text-zinc-400">No qualifying stock or synthetic positions in this bucket.</span>
        ) : null}
      </div>
      <div className="h-80 w-full min-w-0 text-[var(--foreground)]">
        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={320} initialDimension={{ width: 400, height: 320 }}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.2} />
            <XAxis
              type="number"
              dataKey="seqIndex"
              domain={["dataMin", "dataMax"]}
              tickFormatter={(i) => seqLabelByIndex.get(Number(i)) ?? ""}
              tick={{ fontSize: 12, fill: "currentColor" }}
              stroke="currentColor"
              strokeOpacity={0.35}
              interval="preserveStartEnd"
            />
            <YAxis
              tickFormatter={(v) => formatPct(Number(v))}
              tick={{ fontSize: 12, fill: "currentColor" }}
              stroke="currentColor"
              strokeOpacity={0.35}
              width={58}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const row = payload[0]?.payload as Record<string, string | number | null>;
                return (
                  <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs shadow-md dark:border-white/20 dark:bg-zinc-950">
                    <div className="font-medium text-zinc-900 dark:text-zinc-100">{row.asOfLabel}</div>
                    <div className="mt-1 space-y-0.5">
                      {row.Portfolio != null ? (
                        <div style={{ color: PORTFOLIO_LINE_COLOR }}>Portfolio: {formatPct(Number(row.Portfolio))}</div>
                      ) : null}
                      {symbols.map((symbol) => {
                        const position = row[`p:${symbol.symbol}`];
                        const stock = row[`s:${symbol.symbol}`];
                        return (
                          <div key={symbol.symbol}>
                            {position != null ? (
                              <div style={{ color: symbol.color }}>
                                {symbol.symbol}: {formatPct(Number(position))}
                              </div>
                            ) : null}
                            {stock != null ? (
                              <div style={{ color: symbol.color }}>
                                {symbol.symbol} stock: {formatPct(Number(stock))}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              }}
            />
            {symbols
              .filter((symbol) => !hiddenSet.has(symbol.symbol))
              .map((symbol) => (
                <Line
                  key={symbol.symbol}
                  type={filletLinearCurve}
                  dataKey={`p:${symbol.symbol}`}
                  name={symbol.symbol}
                  strokeWidth={2}
                  dot={false}
                  stroke={symbol.color}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              ))}
            {symbols
              .filter((symbol) => !hiddenSet.has(symbol.symbol) && !stockOffSet.has(symbol.symbol))
              .map((symbol) => (
                <Line
                  key={`${symbol.symbol}-stock`}
                  type={filletLinearCurve}
                  dataKey={`s:${symbol.symbol}`}
                  name={`${symbol.symbol} stock`}
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                  dot={false}
                  stroke={symbol.color}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              ))}
            <Line
              type={filletLinearCurve}
              dataKey="Portfolio"
              name="Portfolio"
              strokeWidth={2}
              dot={false}
              stroke={PORTFOLIO_LINE_COLOR}
              connectNulls={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

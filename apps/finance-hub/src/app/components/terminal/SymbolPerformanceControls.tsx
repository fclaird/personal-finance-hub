"use client";

import {
  CHART_CANDLE_INTERVALS,
  chartCandleIntervalLabel,
  coerceIntervalForWindow,
  intervalsForWindow,
  type CandleWindowKey,
  type ChartCandleInterval,
} from "@/lib/terminal/candleChartConfig";

export type ChartMode = "line" | "candle";

const WINDOW_KEYS = ["1D", "5D", "1M", "3M", "6M", "1Y", "3Y", "5Y"] as const;

export type SymbolPerformanceControlsProps = {
  windowKey: CandleWindowKey;
  onWindowChange: (w: CandleWindowKey) => void;
  chartMode: ChartMode;
  onChartModeChange: (m: ChartMode) => void;
  candleInterval: ChartCandleInterval;
  onCandleIntervalChange: (i: ChartCandleInterval) => void;
};

export function SymbolPerformanceControls({
  windowKey,
  onWindowChange,
  chartMode,
  onChartModeChange,
  candleInterval,
  onCandleIntervalChange,
}: SymbolPerformanceControlsProps) {
  const allowedIntervals = intervalsForWindow(windowKey);

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-center justify-end gap-1">
        <div className="mr-1 flex rounded-md border border-zinc-300 dark:border-white/20">
          {(["line", "candle"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => onChartModeChange(mode)}
              className={
                "h-8 px-2.5 text-xs font-semibold capitalize first:rounded-l-md last:rounded-r-md " +
                (chartMode === mode
                  ? "bg-zinc-950 text-white dark:bg-white dark:text-black"
                  : "bg-white text-zinc-900 hover:bg-zinc-50 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5")
              }
            >
              {mode === "line" ? "Line" : "Candles"}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-8 gap-1">
          {WINDOW_KEYS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => onWindowChange(k)}
              className={
                "h-8 rounded-md px-2 text-xs font-semibold " +
                (windowKey === k
                  ? "bg-zinc-950 text-white dark:bg-white dark:text-black"
                  : "border border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5")
              }
            >
              {k}
            </button>
          ))}
        </div>
      </div>
      {chartMode === "candle" ? (
        <div className="flex flex-wrap items-center justify-end gap-1">
          {CHART_CANDLE_INTERVALS.map((iv) => {
            const enabled = allowedIntervals.includes(iv);
            return (
              <button
                key={iv}
                type="button"
                disabled={!enabled}
                onClick={() => onCandleIntervalChange(coerceIntervalForWindow(windowKey, iv))}
                className={
                  "h-7 rounded-md px-2 text-[11px] font-semibold " +
                  (candleInterval === iv
                    ? "bg-teal-800 text-white dark:bg-teal-600"
                    : enabled
                      ? "border border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-white/5"
                      : "cursor-not-allowed border border-zinc-200 text-zinc-400 dark:border-white/10 dark:text-zinc-600")
                }
              >
                {chartCandleIntervalLabel(iv)}
              </button>
            );
          })}
          <span className="ml-1 text-[10px] text-zinc-500 dark:text-zinc-400">Scroll to pan · drag brush below chart</span>
        </div>
      ) : null}
    </div>
  );
}

/** Chart candle intervals exposed in the symbol page UI. */
export type ChartCandleInterval = "5m" | "15m" | "60m" | "240m" | "1d" | "1wk";

export type CandleWindowKey = "1D" | "5D" | "1M" | "3M" | "6M" | "1Y" | "3Y" | "5Y";

export const CHART_CANDLE_INTERVALS: ChartCandleInterval[] = ["5m", "15m", "60m", "240m", "1d", "1wk"];

const INTERVALS_BY_WINDOW: Record<CandleWindowKey, ChartCandleInterval[]> = {
  "1D": ["5m", "15m", "60m"],
  "5D": ["5m", "15m", "60m", "240m"],
  "1M": ["60m", "240m", "1d"],
  "3M": ["60m", "240m", "1d"],
  "6M": ["1d", "1wk"],
  "1Y": ["1d", "1wk"],
  "3Y": ["1d", "1wk"],
  "5Y": ["1d", "1wk"],
};

const DEFAULT_INTERVAL_BY_WINDOW: Record<CandleWindowKey, ChartCandleInterval> = {
  "1D": "5m",
  "5D": "5m",
  "1M": "1d",
  "3M": "1d",
  "6M": "1d",
  "1Y": "1d",
  "3Y": "1d",
  "5Y": "1d",
};

export function intervalsForWindow(window: CandleWindowKey): ChartCandleInterval[] {
  return INTERVALS_BY_WINDOW[window] ?? ["1d"];
}

export function defaultIntervalForWindow(window: CandleWindowKey): ChartCandleInterval {
  return DEFAULT_INTERVAL_BY_WINDOW[window] ?? "1d";
}

export function coerceIntervalForWindow(
  window: CandleWindowKey,
  interval: ChartCandleInterval,
): ChartCandleInterval {
  const allowed = intervalsForWindow(window);
  return allowed.includes(interval) ? interval : defaultIntervalForWindow(window);
}

export function isChartCandleInterval(v: string): v is ChartCandleInterval {
  return (CHART_CANDLE_INTERVALS as string[]).includes(v);
}

/** Human-readable interval label for symbol performance controls. */
export function chartCandleIntervalLabel(id: ChartCandleInterval): string {
  if (id === "60m") return "1h";
  if (id === "240m") return "4h";
  return id;
}

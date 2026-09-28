/**
 * Performance-page benchmarks.
 * Russell 2000 uses the glance IWM symbol (Schwab). WTI, BTC, and ETH use the
 * same Yahoo symbols as the terminal glance tiles (CL=F, BTC-USD, ETH-USD).
 * There is no UST series in this app; ETH is ETH/USD.
 */

/** #0f766e with HSL lightness × 1.3 three times (about 2.2× total), so the portfolio series reads brighter than the benchmarks. */
export const PORTFOLIO_LINE_COLOR = "#3fe6d9";

export const PERFORMANCE_BENCHMARKS = [
  { id: "spy", label: "SPY", symbol: "SPY", provider: "schwab", color: "#2563eb" },
  { id: "qqq", label: "QQQ", symbol: "QQQ", provider: "schwab", color: "#7c3aed" },
  { id: "iwm", label: "Russell 2000", symbol: "IWM", provider: "schwab", color: "#dc2626" },
  { id: "wti", label: "WTI", symbol: "CL=F", provider: "yahoo", color: "#ca8a04" },
  { id: "btc", label: "BTC/USD", symbol: "BTC-USD", provider: "yahoo", color: "#db2777" },
  { id: "eth", label: "ETH/USD", symbol: "ETH-USD", provider: "yahoo", color: "#0891b2" },
] as const;

export type PerformanceBenchmark = (typeof PERFORMANCE_BENCHMARKS)[number];
export type PerformanceBenchmarkId = PerformanceBenchmark["id"];
export type ExtraPerformanceBenchmarkId = Exclude<PerformanceBenchmarkId, "spy" | "qqq">;

export function closesFromYahooChartResult(
  result: Record<string, unknown>,
): Array<{ date: string; close: number }> {
  const timestamps = (result.timestamp as number[] | undefined) ?? [];
  const quote = (result.indicators as Record<string, unknown> | undefined)?.quote as
    | Array<Record<string, unknown>>
    | undefined;
  const closes = (quote?.[0]?.close as Array<number | null> | undefined) ?? [];
  const out: Array<{ date: string; close: number }> = [];
  for (let i = 0; i < timestamps.length; i++) {
    const ts = timestamps[i];
    const close = closes[i];
    if (ts == null || close == null || !Number.isFinite(close) || close <= 0) continue;
    out.push({ date: new Date(ts * 1000).toISOString().slice(0, 10), close });
  }
  return out;
}

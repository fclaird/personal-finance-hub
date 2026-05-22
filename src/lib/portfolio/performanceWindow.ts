/** Client-safe helpers for performance chart time windows (no DB). */

export type PerformanceHistoryTimeframe = "1D" | "1W" | "1M" | "3M" | "6M" | "1Y" | "3Y" | "5Y";

const TF_DAYS: Record<PerformanceHistoryTimeframe, number> = {
  "1D": 1,
  "1W": 7,
  "1M": 30,
  "3M": 90,
  "6M": 180,
  "1Y": 365,
  "3Y": 3 * 365,
  "5Y": 5 * 365,
};

export function timeframeToCutoffIso(tf: PerformanceHistoryTimeframe, nowMs: number): string {
  const day = 86400000;
  return new Date(nowMs - TF_DAYS[tf] * day).toISOString().slice(0, 10);
}

export function timeframeToWindowRangeMs(tf: PerformanceHistoryTimeframe, nowMs: number): { startMs: number; endMs: number } {
  const day = 86400000;
  return { startMs: nowMs - TF_DAYS[tf] * day, endMs: nowMs };
}

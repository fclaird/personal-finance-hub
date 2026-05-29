import type { CandleWindowKey } from "@/lib/terminal/candleChartConfig";

const MS_DAY = 24 * 60 * 60 * 1000;

/** Earliest timestamp to fetch for a chart window (client + server safe). */
export function windowSinceMs(window: CandleWindowKey, nowMs: number = Date.now()): number {
  const durMs =
    window === "1D"
      ? 2 * MS_DAY
      : window === "5D"
        ? 8 * MS_DAY
        : window === "1M"
          ? 40 * MS_DAY
          : window === "3M"
            ? 110 * MS_DAY
            : window === "6M"
              ? 220 * MS_DAY
              : window === "1Y"
                ? 400 * MS_DAY
                : window === "3Y"
                  ? 3 * 400 * MS_DAY
                  : 5 * 400 * MS_DAY;
  return nowMs - durMs;
}

export function extendFetchStartMs(
  window: CandleWindowKey,
  currentStartMs: number,
  extendDays = 5,
): number {
  const candidate = currentStartMs - extendDays * MS_DAY;
  return Math.max(candidate, windowSinceMs(window));
}

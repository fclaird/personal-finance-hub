/**
 * Yahoo chart v8 `indicators.adjclose` only.
 *
 * Observed on query1, 2026-11-07, with no substitution:
 * - AAPL 2020-08-28 chart close 124.81, adjclose 120.9557 (ratio about 1.032).
 * - AAPL early January 2015 chart close 27.3325, adjclose 24.1718 (ratio about 1.131).
 * - The latest AAPL session had adjclose equal to the chart close.
 * - CL=F and BTC-USD returned an adjclose array equal to the chart close in a 5-day sample.
 *
 * So adjclose is the split- and dividend-adjusted series, scaled so the latest
 * session matches the chart close. Chart `quote.close` is not that series.
 * A missing adjclose array is a failure. This module never reads quote.close.
 */

export const ADJUSTED_PROVIDER = "yahoo-adjusted";
export const ADJUSTED_VERSION = "yahoo-adjclose-v1";
export const CORPORATE_ACTIONS = "yahoo-chart-v8-adjclose-splits-and-dividends";
export const ADJUSTED_SOURCE = "yahoo-chart-v8-indicators-adjclose";

export type AdjBar = { readonly date: string; readonly adjClose: number };

export type AdjustedParse =
  | { readonly ok: true; readonly bars: readonly AdjBar[]; readonly timestamps: number; readonly droppedNull: number }
  | { readonly ok: false; readonly reason: "no-adjclose" | "duplicate-date" | "empty" | "nonpositive" };

function isoDateFromUnixSeconds(seconds: number): string {
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

/** Read adjclose aligned to timestamp. Never falls back to quote.close. */
export function adjustedClosesFromYahooChartResult(result: Record<string, unknown> | null | undefined): AdjustedParse {
  if (!result) return { ok: false, reason: "no-adjclose" };
  const timestamps = result.timestamp;
  const indicators = result.indicators;
  if (!Array.isArray(timestamps) || indicators == null || typeof indicators !== "object") {
    return { ok: false, reason: "no-adjclose" };
  }
  const adjBlock = (indicators as { adjclose?: unknown }).adjclose;
  if (!Array.isArray(adjBlock) || adjBlock[0] == null || typeof adjBlock[0] !== "object") {
    return { ok: false, reason: "no-adjclose" };
  }
  const values = (adjBlock[0] as { adjclose?: unknown }).adjclose;
  if (!Array.isArray(values) || values.length !== timestamps.length) {
    return { ok: false, reason: "no-adjclose" };
  }

  const bars: AdjBar[] = [];
  const seen = new Set<string>();
  let droppedNull = 0;
  for (let i = 0; i < timestamps.length; i++) {
    const stamp = timestamps[i];
    const value = values[i];
    if (typeof stamp !== "number" || !Number.isFinite(stamp) || value == null) {
      droppedNull += 1;
      continue;
    }
    if (typeof value !== "number" || !Number.isFinite(value)) {
      droppedNull += 1;
      continue;
    }
    if (!(value > 0)) return { ok: false, reason: "nonpositive" };
    const date = isoDateFromUnixSeconds(stamp);
    if (seen.has(date)) return { ok: false, reason: "duplicate-date" };
    seen.add(date);
    bars.push({ date, adjClose: value });
  }
  if (bars.length < 2) return { ok: false, reason: "empty" };
  bars.sort((a, b) => a.date.localeCompare(b.date));
  return { ok: true, bars, timestamps: timestamps.length, droppedNull };
}

import type { CorrWindow } from "@/lib/screener/types";

/** Trading-day targets. 1y is 251 sessions, as specified. 3m is 63. 3y is 753. */
export const CORR_WINDOW_DAYS: Record<CorrWindow, number> = {
  "3m": 63,
  "1y": 251,
  "3y": 753,
};

export const CORR_WINDOW_LABEL: Record<CorrWindow, string> = {
  "3m": "3 months (63 sessions)",
  "1y": "1 year (251 sessions)",
  "3y": "3 years (753 sessions)",
};

/** Below this many paired daily returns, no correlation is published. */
export const MIN_PAIRED_RETURNS = 20;

export type PriceBar = { date: string; adjClose: number };

export type DailyReturn = { date: string; value: number };

export type CorrelationResult = {
  value: number;
  pairedReturns: number;
  targetReturns: number;
  shortHistory: boolean;
  start: string;
  end: string;
};

export function dailyReturns(bars: PriceBar[]): DailyReturn[] {
  const sorted = bars
    .filter((bar) => bar.date && Number.isFinite(bar.adjClose) && bar.adjClose > 0)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));
  const out: DailyReturn[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    if (prev.date === cur.date) continue;
    out.push({ date: cur.date, value: cur.adjClose / prev.adjClose - 1 });
  }
  return out;
}

export function alignReturns(left: DailyReturn[], right: DailyReturn[]): { dates: string[]; xs: number[]; ys: number[] } {
  const rightByDate = new Map(right.map((row) => [row.date, row.value]));
  const dates: string[] = [];
  const xs: number[] = [];
  const ys: number[] = [];
  for (const row of left) {
    const other = rightByDate.get(row.date);
    if (other == null || !Number.isFinite(row.value) || !Number.isFinite(other)) continue;
    dates.push(row.date);
    xs.push(row.value);
    ys.push(other);
  }
  return { dates, xs, ys };
}

/** Pearson correlation. The /n terms cancel, so this matches the sample coefficient. */
export function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n !== ys.length || n < 2) return null;
  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < n; i++) {
    sumX += xs[i]!;
    sumY += ys[i]!;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i]! - meanX;
    const b = ys[i]! - meanY;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (dx === 0 || dy === 0) return null;
  const value = num / Math.sqrt(dx * dy);
  if (!Number.isFinite(value) || value < -1 || value > 1) return null;
  return value;
}

export function correlationForWindow(
  stock: PriceBar[],
  benchmark: PriceBar[],
  window: CorrWindow,
): CorrelationResult | null {
  const aligned = alignReturns(dailyReturns(stock), dailyReturns(benchmark));
  const target = CORR_WINDOW_DAYS[window];
  if (aligned.xs.length < MIN_PAIRED_RETURNS) return null;
  const startIndex = aligned.xs.length > target ? aligned.xs.length - target : 0;
  const xs = aligned.xs.slice(startIndex);
  const ys = aligned.ys.slice(startIndex);
  const dates = aligned.dates.slice(startIndex);
  const value = pearson(xs, ys);
  if (value == null || dates.length === 0) return null;
  return {
    value,
    pairedReturns: xs.length,
    targetReturns: target,
    shortHistory: xs.length < target,
    start: dates[0]!,
    end: dates[dates.length - 1]!,
  };
}

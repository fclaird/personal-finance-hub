export const CANDLE_UP_COLOR = "#22c55e";
export const CANDLE_DOWN_COLOR = "#ef4444";

export function candleDirection(open: number, close: number): "up" | "down" {
  return close >= open ? "up" : "down";
}

export function candleColor(open: number, close: number): string {
  return candleDirection(open, close) === "up" ? CANDLE_UP_COLOR : CANDLE_DOWN_COLOR;
}

export type OhlcBar = {
  tsMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

export type CandleChartRow = OhlcBar & {
  qqqPct?: number | null;
  spyPct?: number | null;
};

/** Y-axis domain padding for price scale. */
export function priceYDomain(candles: OhlcBar[], padPct = 0.02): [number, number] {
  if (candles.length === 0) return [0, 1];
  let lo = Infinity;
  let hi = -Infinity;
  for (const c of candles) {
    if (Number.isFinite(c.low)) lo = Math.min(lo, c.low);
    if (Number.isFinite(c.high)) hi = Math.max(hi, c.high);
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1];
  if (lo === hi) {
    const pad = Math.max(Math.abs(lo) * padPct, 0.01);
    return [lo - pad, hi + pad];
  }
  const pad = (hi - lo) * padPct;
  return [lo - pad, hi + pad];
}

export function pctYDomain(rows: CandleChartRow[]): [number, number] {
  let lo = 0;
  let hi = 0;
  for (const r of rows) {
    for (const v of [r.qqqPct, r.spyPct]) {
      if (v == null || !Number.isFinite(v)) continue;
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
  }
  const pad = Math.max((hi - lo) * 0.1, 0.5);
  return [lo - pad, hi + pad];
}

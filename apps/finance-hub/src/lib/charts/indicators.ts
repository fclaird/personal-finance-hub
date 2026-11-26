/**
 * Indicator math matching TradingView's usual definitions:
 * SMA of the source, EMA seeded with that SMA, Bollinger using population
 * standard deviation, and Ichimoku midpoints shifted by the displacement.
 */

export type Num = number | null;

export type OhlcBar = {
  open: number;
  high: number;
  low: number;
  close: number;
};

export function sma(values: readonly number[], period: number): Num[] {
  const out: Num[] = values.map(() => null);
  if (period < 1) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i]!;
    if (i >= period) sum -= values[i - period]!;
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** EMA seeded with the SMA of the first `period` values. Alpha is 2 / (period + 1). */
export function ema(values: readonly number[], period: number): Num[] {
  const out: Num[] = values.map(() => null);
  if (period < 1 || values.length < period) return out;
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i]!;
  const alpha = 2 / (period + 1);
  let prev = seed / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = alpha * values[i]! + (1 - alpha) * prev;
    out[i] = prev;
  }
  return out;
}

export type Bollinger = {
  middle: Num[];
  upper: Num[];
  lower: Num[];
};

/** Middle band is SMA. Bands use the population standard deviation (divide by N). */
export function bollinger(values: readonly number[], period: number, mult: number): Bollinger {
  const middle = sma(values, period);
  const upper: Num[] = values.map(() => null);
  const lower: Num[] = values.map(() => null);
  if (period < 1) return { middle, upper, lower };
  for (let i = period - 1; i < values.length; i++) {
    const mid = middle[i];
    if (mid == null) continue;
    let acc = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const d = values[j]! - mid;
      acc += d * d;
    }
    const sd = Math.sqrt(acc / period);
    upper[i] = mid + mult * sd;
    lower[i] = mid - mult * sd;
  }
  return { middle, upper, lower };
}

function donchian(bars: readonly OhlcBar[], period: number): Num[] {
  const out: Num[] = bars.map(() => null);
  if (period < 1) return out;
  for (let i = period - 1; i < bars.length; i++) {
    let high = -Infinity;
    let low = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      high = Math.max(high, bars[j]!.high);
      low = Math.min(low, bars[j]!.low);
    }
    out[i] = (high + low) / 2;
  }
  return out;
}

export type Ichimoku = {
  conversion: Num[];
  base: Num[];
  /** Span A plotted `displacement` bars ahead. Length is bars + displacement. */
  spanA: Num[];
  /** Span B plotted `displacement` bars ahead. Length is bars + displacement. */
  spanB: Num[];
  /** Close plotted `displacement` bars back, aligned to the bar where it is drawn. */
  lagging: Num[];
  /** Span A before the forward shift, aligned to the source bar. */
  spanARaw: Num[];
  spanBRaw: Num[];
};

export function ichimoku(
  bars: readonly OhlcBar[],
  conversionPeriod = 9,
  basePeriod = 26,
  spanPeriod = 52,
  displacement = 26,
): Ichimoku {
  const conversion = donchian(bars, conversionPeriod);
  const base = donchian(bars, basePeriod);
  const spanBRaw = donchian(bars, spanPeriod);
  const spanARaw: Num[] = bars.map((_, i) => {
    const c = conversion[i];
    const b = base[i];
    return c == null || b == null ? null : (c + b) / 2;
  });
  const shift = Math.max(0, Math.round(displacement));
  const spanA: Num[] = Array.from({ length: bars.length + shift }, () => null);
  const spanB: Num[] = Array.from({ length: bars.length + shift }, () => null);
  for (let i = 0; i < bars.length; i++) {
    if (spanARaw[i] != null) spanA[i + shift] = spanARaw[i];
    if (spanBRaw[i] != null) spanB[i + shift] = spanBRaw[i];
  }
  const lagging: Num[] = bars.map((_, i) => {
    const src = i + shift;
    return src < bars.length ? bars[src]!.close : null;
  });
  return { conversion, base, spanA, spanB, lagging, spanARaw, spanBRaw };
}

export type VwapBar = {
  high: number;
  low: number;
  close: number;
  volume: number;
  /** Null bars are outside the session and do not affect the cumulative. */
  session: string | null;
};

/** Session VWAP from typical price (H+L+C)/3. Resets when `session` changes. */
export function sessionVwap(bars: readonly VwapBar[]): Num[] {
  const out: Num[] = [];
  let pv = 0;
  let vol = 0;
  let key: string | null = null;
  for (const bar of bars) {
    if (!bar.session) {
      out.push(null);
      continue;
    }
    if (bar.session !== key) {
      pv = 0;
      vol = 0;
      key = bar.session;
    }
    const typical = (bar.high + bar.low + bar.close) / 3;
    pv += typical * bar.volume;
    vol += bar.volume;
    out.push(vol > 0 ? pv / vol : null);
  }
  return out;
}

export type DatedClose = { time: string; close: number };

/**
 * Bull Market Support Band: weekly 20 SMA and 21 EMA of weekly closes,
 * mapped onto each daily bar. The current week uses that day's close so far
 * (no lookahead to later days in the week).
 */
export function bullMarketSupportBand(
  bars: readonly DatedClose[],
  smaPeriod = 20,
  emaPeriod = 21,
  weekStart: (iso: string) => string = mondayWeekStart,
): { sma: Num[]; ema: Num[] } {
  const bandSma: Num[] = bars.map(() => null);
  const bandEma: Num[] = bars.map(() => null);
  const completed: number[] = [];
  let weekKey = "";
  let weekClose = 0;
  for (let i = 0; i < bars.length; i++) {
    const key = weekStart(bars[i]!.time);
    if (weekKey && key !== weekKey) completed.push(weekClose);
    weekKey = key;
    weekClose = bars[i]!.close;
    const series = completed.concat(weekClose);
    const weeklySma = sma(series, smaPeriod);
    const weeklyEma = ema(series, emaPeriod);
    bandSma[i] = weeklySma[weeklySma.length - 1] ?? null;
    bandEma[i] = weeklyEma[weeklyEma.length - 1] ?? null;
  }
  return { sma: bandSma, ema: bandEma };
}

export function mondayWeekStart(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1));
  const day = dt.getUTCDay();
  const delta = day === 0 ? -6 : 1 - day;
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

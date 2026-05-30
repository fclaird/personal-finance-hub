import { getDb } from "@/lib/db";
import { logError } from "@/lib/log";
import { isUsEquityOvernightDeadZone } from "@/lib/market/glanceExtendedHours";
import { schwabMarketFetch } from "@/lib/schwab/client";
import type { ChartCandleInterval } from "@/lib/terminal/candleChartConfig";
import { windowSinceMs as windowSinceMsFromConfig } from "@/lib/terminal/candleWindowTime";

export type Candle = {
  tsMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type SchwabPriceHistoryResp = {
  candles?: Array<{
    datetime: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;
  symbol?: string;
  empty?: boolean;
};

/** Intervals stored in `ohlcv_points` (Schwab-native or weekly). */
export type StorageCandleInterval = "5m" | "15m" | "30m" | "1d" | "1wk";

/** @deprecated Use StorageCandleInterval for DB keys; ChartCandleInterval for UI/API. */
export type CandleInterval = StorageCandleInterval;

export type CandleWindow = "1D" | "5D" | "1M" | "3M" | "6M" | "1Y" | "3Y" | "5Y";

const MS_MIN = 60 * 1000;
const MS_HOUR = 60 * MS_MIN;
const MS_DAY = 24 * MS_HOUR;
const INTRADAY_CACHE_FRESH_MS = 12 * MS_HOUR;

/** Minimum stored daily bars to treat a window as cache-warm (avoids refetching on every request). */
const MIN_DAILY_BARS_FOR_WINDOW: Record<CandleWindow, number> = {
  "1D": 1,
  "5D": 4,
  "1M": 18,
  "3M": 55,
  "6M": 100,
  "1Y": 200,
  "3Y": 500,
  "5Y": 800,
};

function hasSufficientDailyCache(
  symbol: string,
  storage: StorageCandleInterval,
  window: CandleWindow,
): boolean {
  if (storage !== "1d" && storage !== "1wk") return false;
  const since = windowSinceMsFromConfig(window);
  const cached = getCachedCandles(symbol, storage, since);
  return cached.length >= MIN_DAILY_BARS_FOR_WINDOW[window];
}

export function hasSufficientIntradayCandles(
  cached: readonly Pick<Candle, "tsMs">[],
  window: CandleWindow,
  nowMs: number = Date.now(),
): boolean {
  if (window !== "1D" && window !== "5D") return false;
  const minBars = window === "1D" ? 40 : 150;
  if (cached.length < minBars) return false;
  const latest = cached[cached.length - 1]?.tsMs;
  if (latest == null || !Number.isFinite(latest)) return false;
  return nowMs - latest < INTRADAY_CACHE_FRESH_MS;
}

function hasSufficientIntradayCache(
  symbol: string,
  storage: StorageCandleInterval,
  window: CandleWindow,
): boolean {
  if (storage !== "5m" && storage !== "15m" && storage !== "30m") return false;
  if (window !== "1D" && window !== "5D") return false;
  const since = windowSinceMsFromConfig(window);
  const cached = getCachedCandles(symbol, storage, since);
  return hasSufficientIntradayCandles(cached, window);
}

function hasSufficientCachedCandles(
  symbol: string,
  storage: StorageCandleInterval,
  window: CandleWindow,
): boolean {
  return hasSufficientDailyCache(symbol, storage, window) || hasSufficientIntradayCache(symbol, storage, window);
}

export const CHART_INTERVAL_BUCKET_MS: Record<ChartCandleInterval, number> = {
  "5m": 5 * MS_MIN,
  "15m": 15 * MS_MIN,
  "60m": MS_HOUR,
  "240m": 4 * MS_HOUR,
  "1d": MS_DAY,
  "1wk": 7 * MS_DAY,
};

export function storageIntervalForChart(interval: ChartCandleInterval): StorageCandleInterval {
  if (interval === "60m" || interval === "240m") return "30m";
  if (interval === "1wk") return "1wk";
  return interval;
}

function schwabFrequencyForStorage(interval: StorageCandleInterval): {
  frequencyType: string;
  frequency: string;
} {
  switch (interval) {
    case "5m":
      return { frequencyType: "minute", frequency: "5" };
    case "15m":
      return { frequencyType: "minute", frequency: "15" };
    case "30m":
      return { frequencyType: "minute", frequency: "30" };
    case "1d":
      return { frequencyType: "daily", frequency: "1" };
    case "1wk":
      return { frequencyType: "weekly", frequency: "1" };
  }
}

function periodParamsForWindow(window: CandleWindow, storageInterval: StorageCandleInterval): {
  periodType: string;
  period: string;
} {
  const minuteLike = storageInterval === "5m" || storageInterval === "15m" || storageInterval === "30m";
  if (minuteLike) {
    if (window === "5D") return { periodType: "day", period: "5" };
    if (window === "1D") return { periodType: "day", period: "1" };
    return { periodType: "day", period: "10" };
  }
  const map: Record<CandleWindow, { periodType: string; period: string }> = {
    "1D": { periodType: "month", period: "1" },
    "5D": { periodType: "month", period: "1" },
    "1M": { periodType: "month", period: "1" },
    "3M": { periodType: "month", period: "3" },
    "6M": { periodType: "month", period: "6" },
    "1Y": { periodType: "year", period: "1" },
    "3Y": { periodType: "year", period: "3" },
    "5Y": { periodType: "year", period: "5" },
  };
  return map[window];
}

function schwabDateParam(ms: number, bound: "start" | "end"): string {
  const d = new Date(ms);
  if (bound === "start") {
    return `${d.toISOString().slice(0, 10)}T00:00:00.000Z`;
  }
  return `${d.toISOString().slice(0, 10)}T23:59:59.000Z`;
}

/** Merge consecutive candles into larger buckets (used for 1h / 4h from 30m). */
export function aggregateCandles(candles: Candle[], bucketMs: number): Candle[] {
  if (candles.length === 0 || bucketMs <= 0) return [];
  const sorted = [...candles].sort((a, b) => a.tsMs - b.tsMs);
  const out: Candle[] = [];
  let bucketStart = Math.floor(sorted[0]!.tsMs / bucketMs) * bucketMs;
  let open = sorted[0]!.open;
  let high = sorted[0]!.high;
  let low = sorted[0]!.low;
  let close = sorted[0]!.close;
  let volume = sorted[0]!.volume;

  for (let i = 1; i < sorted.length; i++) {
    const c = sorted[i]!;
    const b = Math.floor(c.tsMs / bucketMs) * bucketMs;
    if (b !== bucketStart) {
      out.push({ tsMs: bucketStart, open, high, low, close, volume });
      bucketStart = b;
      open = c.open;
      high = c.high;
      low = c.low;
      close = c.close;
      volume = c.volume;
    } else {
      high = Math.max(high, c.high);
      low = Math.min(low, c.low);
      close = c.close;
      volume += c.volume;
    }
  }
  out.push({ tsMs: bucketStart, open, high, low, close, volume });
  return out;
}

function applyChartInterval(candles: Candle[], chartInterval: ChartCandleInterval): Candle[] {
  if (chartInterval === "60m") return aggregateCandles(candles, CHART_INTERVAL_BUCKET_MS["60m"]);
  if (chartInterval === "240m") return aggregateCandles(candles, CHART_INTERVAL_BUCKET_MS["240m"]);
  return candles;
}

function filterCandlesByRange(
  candles: Candle[],
  sinceMs?: number,
  untilMs?: number,
): Candle[] {
  return candles.filter((c) => {
    if (sinceMs != null && c.tsMs < sinceMs) return false;
    if (untilMs != null && c.tsMs > untilMs) return false;
    return true;
  });
}

export async function ensureCandles(
  symbol: string,
  interval: StorageCandleInterval,
  window: CandleWindow,
  opts?: { startMs?: number; endMs?: number; force?: boolean },
): Promise<void> {
  const storage = interval;

  const db = getDb();
  const sym = (symbol ?? "").trim().toUpperCase();
  if (!sym) return;

  if (!opts?.force && opts?.startMs == null && opts?.endMs == null) {
    if (hasSufficientCachedCandles(sym, storage, window)) {
      return;
    }

    const latest = db
      .prepare(
        `
      SELECT ts_ms AS ts
      FROM ohlcv_points
      WHERE provider='schwab' AND symbol=? AND interval=?
      ORDER BY ts_ms DESC
      LIMIT 1
    `,
      )
      .get(sym, storage) as { ts: number } | undefined;

    if (latest?.ts) {
      const ageMs = Date.now() - latest.ts;
      if (ageMs < 12 * 60 * 60 * 1000) {
        return;
      }
    }
  }

  const params = new URLSearchParams();
  params.set("symbol", sym);
  const period = periodParamsForWindow(window, storage);
  const freq = schwabFrequencyForStorage(storage);
  params.set("periodType", period.periodType);
  params.set("period", period.period);
  params.set("frequencyType", freq.frequencyType);
  params.set("frequency", freq.frequency);
  if (opts?.startMs != null) params.set("startDate", schwabDateParam(opts.startMs, "start"));
  if (opts?.endMs != null) params.set("endDate", schwabDateParam(opts.endMs, "end"));

  let data: SchwabPriceHistoryResp;
  try {
    data = await schwabMarketFetch<SchwabPriceHistoryResp>(`/pricehistory?${params.toString()}`);
  } catch (e) {
    logError(`terminal_pricehistory_failed_${sym}_${storage}_${window}`, e);
    const cached = getCachedCandles(sym, storage);
    if (cached.length > 0) return;
    throw e;
  }

  const candles = data.candles ?? [];
  if (candles.length === 0) return;

  const upsert = db.prepare(`
    INSERT INTO ohlcv_points (provider, symbol, interval, ts_ms, open, high, low, close, volume)
    VALUES ('schwab', @symbol, @interval, @ts_ms, @open, @high, @low, @close, @volume)
    ON CONFLICT(provider, symbol, interval, ts_ms)
    DO UPDATE SET open=excluded.open, high=excluded.high, low=excluded.low, close=excluded.close, volume=excluded.volume
  `);

  const tx = db.transaction(() => {
    for (const c of candles) {
      upsert.run({
        symbol: sym,
        interval: storage,
        ts_ms: c.datetime,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      });
    }
  });
  tx();
}

export function getCachedCandles(
  symbol: string,
  interval: StorageCandleInterval,
  sinceMs?: number,
  untilMs?: number,
): Candle[] {
  const db = getDb();
  const sym = (symbol ?? "").trim().toUpperCase();
  const rows = db
    .prepare(
      `
      SELECT ts_ms AS tsMs, open, high, low, close, volume
      FROM ohlcv_points
      WHERE provider='schwab' AND symbol=? AND interval=?
        AND (@since IS NULL OR ts_ms >= @since)
        AND (@until IS NULL OR ts_ms <= @until)
      ORDER BY ts_ms ASC
    `,
    )
    .all({ since: sinceMs ?? null, until: untilMs ?? null }, sym, interval) as Array<{
    tsMs: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;
  return rows.map((r) => ({
    tsMs: r.tsMs,
    open: r.open ?? 0,
    high: r.high ?? 0,
    low: r.low ?? 0,
    close: r.close ?? 0,
    volume: r.volume ?? 0,
  }));
}

export function chartCandlesExcludeDeadZone(
  window: CandleWindow,
  chartInterval: ChartCandleInterval,
): boolean {
  if (window !== "1D" && window !== "5D") return false;
  return chartInterval === "5m" || chartInterval === "15m" || chartInterval === "60m" || chartInterval === "240m";
}

export function filterChartCandlesDeadZone(candles: Candle[]): Candle[] {
  return candles.filter((c) => !isUsEquityOvernightDeadZone(c.tsMs));
}

/** Read candles for a chart interval (aggregates 30m → 1h/4h when needed). */
export function getChartCandles(
  symbol: string,
  chartInterval: ChartCandleInterval,
  sinceMs?: number,
  untilMs?: number,
  window?: CandleWindow,
): Candle[] {
  const storage = storageIntervalForChart(chartInterval);
  const raw = getCachedCandles(symbol, storage, sinceMs, untilMs);
  let candles = filterCandlesByRange(applyChartInterval(raw, chartInterval), sinceMs, untilMs);
  if (window && chartCandlesExcludeDeadZone(window, chartInterval)) {
    candles = filterChartCandlesDeadZone(candles);
  }
  return candles;
}

export async function ensureChartCandles(
  symbol: string,
  chartInterval: ChartCandleInterval,
  window: CandleWindow,
  opts?: { startMs?: number; endMs?: number; force?: boolean },
): Promise<Candle[]> {
  const storage = storageIntervalForChart(chartInterval);
  await ensureCandles(symbol, storage, window, opts);
  const since = opts?.startMs ?? windowSinceMs(window);
  return getChartCandles(symbol, chartInterval, since, opts?.endMs, window);
}

export function windowSinceMs(window: CandleWindow, nowMs: number = Date.now()): number {
  return windowSinceMsFromConfig(window, nowMs);
}

export type BenchmarkOverlayPoint = { tsMs: number; pct: number };

/** Rebase benchmark closes to % change vs first candle in the primary series. */
export function benchmarkPctOverlay(
  benchmarkCandles: Candle[],
  primaryCandles: Candle[],
): BenchmarkOverlayPoint[] {
  if (primaryCandles.length === 0 || benchmarkCandles.length === 0) return [];
  const benchSorted = [...benchmarkCandles].sort((a, b) => a.tsMs - b.tsMs);
  const baseClose = benchSorted[0]!.close;
  if (!Number.isFinite(baseClose) || baseClose <= 0) return [];

  const out: BenchmarkOverlayPoint[] = [];
  let bi = 0;
  for (const p of primaryCandles) {
    while (bi + 1 < benchSorted.length && benchSorted[bi + 1]!.tsMs <= p.tsMs) bi++;
    const b = benchSorted[bi]!;
    if (b.tsMs > p.tsMs && bi > 0) {
      const prev = benchSorted[bi - 1]!;
      const span = p.tsMs - prev.tsMs;
      const denom = b.tsMs - prev.tsMs;
      const frac = denom > 0 ? span / denom : 0;
      const close = prev.close * (1 - frac) + b.close * frac;
      out.push({ tsMs: p.tsMs, pct: ((close / baseClose) - 1) * 100 });
    } else {
      out.push({ tsMs: p.tsMs, pct: ((b.close / baseClose) - 1) * 100 });
    }
  }
  return out;
}

export function trailingAvgDailyVolume(symbol: string, days = 20): number | null {
  const db = getDb();
  const sym = (symbol ?? "").trim().toUpperCase();
  const rows = db
    .prepare(
      `
      SELECT volume
      FROM ohlcv_points
      WHERE provider='schwab' AND symbol=? AND interval='1d' AND volume IS NOT NULL
      ORDER BY ts_ms DESC
      LIMIT ?
    `,
    )
    .all(sym, days) as Array<{ volume: number }>;
  if (rows.length < Math.min(5, days)) return null;
  const avg = rows.reduce((s, r) => s + (typeof r.volume === "number" ? r.volume : 0), 0) / rows.length;
  return Number.isFinite(avg) && avg > 0 ? avg : null;
}

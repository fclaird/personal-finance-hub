import { getDb } from "@/lib/db";
import { logError } from "@/lib/log";
import { schwabMarketFetch } from "@/lib/schwab/client";

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
    datetime: number; // ms epoch
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;
  symbol?: string;
  empty?: boolean;
};

export type CandleInterval = "1d" | "5m";
export type CandleWindow = "1D" | "5D" | "1M" | "3M" | "6M" | "1Y" | "3Y" | "5Y";

function intervalParams(interval: CandleInterval, window: CandleWindow) {
  // Keep API calls simple + cacheable.
  // Intraday: use 5m bars for 1D/5D.
  if (interval === "5m") {
    return {
      periodType: "day",
      period: window === "5D" ? "5" : "1",
      frequencyType: "minute",
      frequency: "5",
    };
  }
  // Daily candles for longer windows.
  const map: Record<CandleWindow, { periodType: string; period: string }> = {
    "1D": { periodType: "month", period: "1" }, // fallback if requested incorrectly
    "5D": { periodType: "month", period: "1" }, // fallback if requested incorrectly
    "1M": { periodType: "month", period: "1" },
    "3M": { periodType: "month", period: "3" },
    "6M": { periodType: "month", period: "6" },
    "1Y": { periodType: "year", period: "1" },
    "3Y": { periodType: "year", period: "3" },
    "5Y": { periodType: "year", period: "5" },
  };
  const p = map[window];
  return { ...p, frequencyType: "daily", frequency: "1" };
}

export async function ensureCandles(symbol: string, interval: CandleInterval, window: CandleWindow): Promise<void> {
  const db = getDb();
  const sym = (symbol ?? "").trim().toUpperCase();
  if (!sym) return;

  // Use a freshness heuristic: if we already have a candle within last day, skip.
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
    .get(sym, interval) as { ts: number } | undefined;

  if (latest?.ts) {
    const ageMs = Date.now() - latest.ts;
    if (ageMs < 12 * 60 * 60 * 1000) return; // 12h
  }

  const params = new URLSearchParams();
  params.set("symbol", sym);
  const p = intervalParams(interval, window);
  params.set("periodType", p.periodType);
  params.set("period", p.period);
  params.set("frequencyType", p.frequencyType);
  params.set("frequency", p.frequency);

  let data: SchwabPriceHistoryResp;
  try {
    data = await schwabMarketFetch<SchwabPriceHistoryResp>(`/pricehistory?${params.toString()}`);
  } catch (e) {
    logError(`terminal_pricehistory_failed_${sym}_${interval}_${window}`, e);
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
        interval,
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

export function getCachedCandles(symbol: string, interval: CandleInterval, sinceMs?: number): Candle[] {
  const db = getDb();
  const sym = (symbol ?? "").trim().toUpperCase();
  const rows = db
    .prepare(
      `
      SELECT ts_ms AS tsMs, open, high, low, close, volume
      FROM ohlcv_points
      WHERE provider='schwab' AND symbol=? AND interval=?
        AND (@since IS NULL OR ts_ms >= @since)
      ORDER BY ts_ms ASC
    `,
    )
    .all({ since: sinceMs ?? null }, sym, interval) as Array<{
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


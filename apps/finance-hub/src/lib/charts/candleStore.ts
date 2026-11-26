import type Database from "better-sqlite3";

import type { ChartCandle, ChartQuoteMeta } from "@/lib/charts/types";
import type { StorageInterval } from "@/lib/charts/yahooOhlcv";
import { sessionDate } from "@/lib/charts/bars";

export const YAHOO_CHART_PROVIDER = "yahoo-chart";

const FRESH_MS: Record<StorageInterval, number> = {
  "1d": 15 * 60 * 1000,
  "5m": 5 * 60 * 1000,
  "15m": 5 * 60 * 1000,
  "60m": 5 * 60 * 1000,
};

export function cacheIsFresh(fetchedAtIso: string | null, interval: StorageInterval, now = Date.now()): boolean {
  if (!fetchedAtIso) return false;
  const age = now - Date.parse(fetchedAtIso);
  if (!Number.isFinite(age) || age < 0) return false;
  return age < FRESH_MS[interval];
}

type CacheRow = { fetched_at: string; meta_json: string | null };

export function readCacheMeta(
  db: Database.Database,
  symbol: string,
  interval: StorageInterval,
): { fetchedAt: string; meta: ChartQuoteMeta | null } | null {
  const row = db
    .prepare(
      `SELECT fetched_at, meta_json FROM chart_candle_cache WHERE provider = ? AND symbol = ? AND interval = ?`,
    )
    .get(YAHOO_CHART_PROVIDER, symbol, interval) as CacheRow | undefined;
  if (!row) return null;
  let meta: ChartQuoteMeta | null = null;
  if (row.meta_json) {
    try {
      meta = JSON.parse(row.meta_json) as ChartQuoteMeta;
    } catch {
      meta = null;
    }
  }
  return { fetchedAt: row.fetched_at, meta };
}

type PointRow = { ts_ms: number; open: number; high: number; low: number; close: number; volume: number | null };

export function readStoredCandles(db: Database.Database, symbol: string, interval: StorageInterval): ChartCandle[] {
  const rows = db
    .prepare(
      `SELECT ts_ms, open, high, low, close, volume
       FROM ohlcv_points
       WHERE provider = ? AND symbol = ? AND interval = ?
       ORDER BY ts_ms ASC`,
    )
    .all(YAHOO_CHART_PROVIDER, symbol, interval) as PointRow[];
  const byKey = new Map<string, ChartCandle & { ts: number }>();
  for (const row of rows) {
    if (![row.open, row.high, row.low, row.close].every((value) => typeof value === "number" && Number.isFinite(value))) continue;
    const ts = row.ts_ms / 1000;
    const time = interval === "1d" ? sessionDate(ts) : ts;
    byKey.set(String(time), {
      time,
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      volume: row.volume ?? 0,
      ts,
    });
  }
  return [...byKey.values()]
    .sort((a, b) => a.ts - b.ts)
    .map(({ time, open, high, low, close, volume }) => ({ time, open, high, low, close, volume }));
}

export function writeStoredCandles(
  db: Database.Database,
  symbol: string,
  interval: StorageInterval,
  candles: readonly ChartCandle[],
  meta: ChartQuoteMeta,
  fetchedAt = new Date().toISOString(),
): void {
  const upsert = db.prepare(
    `INSERT INTO ohlcv_points (provider, symbol, interval, ts_ms, open, high, low, close, volume)
     VALUES (@provider, @symbol, @interval, @ts_ms, @open, @high, @low, @close, @volume)
     ON CONFLICT(provider, symbol, interval, ts_ms)
     DO UPDATE SET open = excluded.open, high = excluded.high, low = excluded.low, close = excluded.close, volume = excluded.volume`,
  );
  const metaUpsert = db.prepare(
    `INSERT INTO chart_candle_cache (provider, symbol, interval, fetched_at, meta_json)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(provider, symbol, interval)
     DO UPDATE SET fetched_at = excluded.fetched_at, meta_json = excluded.meta_json`,
  );
  const tx = db.transaction(() => {
    for (const candle of candles) {
      // 17:00 UTC sits inside the New York session date for both EST and EDT.
      const tsSec = typeof candle.time === "number" ? candle.time : Date.parse(`${candle.time}T17:00:00Z`) / 1000;
      if (!Number.isFinite(tsSec)) continue;
      upsert.run({
        provider: YAHOO_CHART_PROVIDER,
        symbol,
        interval,
        ts_ms: Math.round(tsSec * 1000),
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
      });
    }
    metaUpsert.run(YAHOO_CHART_PROVIDER, symbol, interval, fetchedAt, JSON.stringify(meta));
  });
  tx();
}

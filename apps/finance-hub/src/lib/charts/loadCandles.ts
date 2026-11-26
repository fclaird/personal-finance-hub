import type Database from "better-sqlite3";

import { aggregateCandles } from "@/lib/charts/bars";
import { cacheIsFresh, readCacheMeta, readStoredCandles, writeStoredCandles } from "@/lib/charts/candleStore";
import type { ChartCandle, ChartInterval, ChartQuoteMeta } from "@/lib/charts/types";
import { fetchYahooOhlcv, type StorageInterval } from "@/lib/charts/yahooOhlcv";
import { logError } from "@/lib/log";

export type ChartLoad = {
  symbol: string;
  interval: ChartInterval;
  candles: ChartCandle[];
  meta: ChartQuoteMeta;
  fromCache: boolean;
};

const EMPTY_META: ChartQuoteMeta = {
  name: null,
  exchange: null,
  currency: null,
  marketState: null,
  previousClose: null,
  postMarket: null,
  preMarket: null,
  timezone: null,
};

function storageFor(interval: ChartInterval): StorageInterval {
  if (interval === "1wk" || interval === "1mo") return "1d";
  return interval;
}

const inflight = new Map<string, Promise<{ candles: ChartCandle[]; meta: ChartQuoteMeta }>>();

async function refresh(symbol: string, interval: StorageInterval): Promise<{ candles: ChartCandle[]; meta: ChartQuoteMeta }> {
  const key = `${symbol}:${interval}`;
  const existing = inflight.get(key);
  if (existing) return existing;
  const job = fetchYahooOhlcv(symbol, interval).finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, job);
  return job;
}

export async function loadChartCandles(db: Database.Database, symbol: string, interval: ChartInterval): Promise<ChartLoad> {
  const storage = storageFor(interval);
  const cached = readStoredCandles(db, symbol, storage);
  const metaRow = readCacheMeta(db, symbol, storage);
  let candles = cached;
  let meta = metaRow?.meta ?? EMPTY_META;
  let fromCache = true;
  if (!cacheIsFresh(metaRow?.fetchedAt ?? null, storage) || cached.length === 0) {
    try {
      const fetched = await refresh(symbol, storage);
      if (fetched.candles.length > 0) {
        writeStoredCandles(db, symbol, storage, fetched.candles, fetched.meta);
        candles = fetched.candles;
        meta = fetched.meta;
        fromCache = false;
      }
    } catch (error) {
      logError(`chart_yahoo_${symbol}_${storage}`, error);
      if (candles.length === 0) throw error;
    }
  }
  const view = interval === "1wk" || interval === "1mo" ? aggregateCandles(candles, interval) : candles;
  return { symbol, interval, candles: view, meta, fromCache };
}

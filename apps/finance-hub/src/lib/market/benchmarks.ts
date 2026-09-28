import { getDb } from "@/lib/db";
import { logError } from "@/lib/log";
import { closesFromYahooChartResult } from "@/lib/market/performanceBenchmarks";
import { fetchYahooDailyChart, yahooChartSymbol } from "@/lib/market/yahooChartFetch";
import { schwabMarketFetch } from "@/lib/schwab/client";

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

function isoDateFromMs(ms: number) {
  return new Date(ms).toISOString().slice(0, 10);
}

export function countBenchmarkPriceRows(symbol: string): number {
  const db = getDb();
  const row = db
    .prepare(`SELECT COUNT(1) AS n FROM price_points WHERE provider='schwab' AND symbol = ?`)
    .get(symbol) as { n: number } | undefined;
  return row?.n ?? 0;
}

export function latestBenchmarkDate(symbol: string): string | null {
  const db = getDb();
  const row = db
    .prepare(`SELECT MAX(date) AS d FROM price_points WHERE provider = 'schwab' AND symbol = ?`)
    .get(symbol) as { d: string | null } | undefined;
  return row?.d ?? null;
}

async function fetchAndUpsertBenchmarkHistory(symbol: string): Promise<void> {
  const db = getDb();
  const upsert = db.prepare(`
    INSERT INTO price_points (provider, symbol, date, close)
    VALUES ('schwab', @symbol, @date, @close)
    ON CONFLICT(provider, symbol, date) DO UPDATE SET close = excluded.close
  `);

  for (const period of ["20", "5", "1"] as const) {
    const params = new URLSearchParams();
    params.set("symbol", symbol);
    params.set("periodType", "year");
    params.set("period", period);
    params.set("frequencyType", "daily");
    params.set("frequency", "1");

    let data: SchwabPriceHistoryResp;
    try {
      data = await schwabMarketFetch<SchwabPriceHistoryResp>(`/pricehistory?${params.toString()}`);
    } catch (e) {
      logError(`benchmark_fetch_failed_${symbol}_y${period}`, e);
      throw e;
    }

    const candles = data.candles ?? [];
    if (candles.length === 0) {
      logError(
        `benchmark_empty_candles_${symbol}`,
        new Error(`Schwab pricehistory returned 0 candles (period=${period}y, empty=${String(data.empty)})`),
      );
      continue;
    }

    const tx = db.transaction(() => {
      for (const c of candles) {
        upsert.run({ symbol, date: isoDateFromMs(c.datetime), close: c.close });
      }
    });
    tx();
    return;
  }
}

/**
 * Cache daily closes for benchmarks (SPY/QQQ). Tries 20y, then 5y, then 1y if Schwab returns no candles.
 * Re-fetches when cache is empty or latest cached date is before `minThroughDate` (defaults to today UTC).
 */
export async function ensureBenchmarkHistory(symbol: string, minThroughDate?: string): Promise<void> {
  const db = getDb();
  const through = minThroughDate ?? new Date().toISOString().slice(0, 10);

  const cachedCount = db
    .prepare(`SELECT COUNT(1) AS n FROM price_points WHERE provider='schwab' AND symbol = ?`)
    .get(symbol) as { n: number } | undefined;

  const latest = latestBenchmarkDate(symbol);
  const stale = !latest || latest < through;

  if ((cachedCount?.n ?? 0) >= 1500 && !stale) return;

  await fetchAndUpsertBenchmarkHistory(symbol);
}

/**
 * Cache Yahoo daily closes (WTI CL=F, BTC-USD, ETH-USD) in price_points.
 * Reuses the same Yahoo daily chart fetch as fund NAV history.
 */
export async function ensureYahooBenchmarkHistory(symbol: string, minThroughDate?: string): Promise<void> {
  const sym = yahooChartSymbol(symbol);
  const db = getDb();
  const through = minThroughDate ?? new Date().toISOString().slice(0, 10);

  const cached = db
    .prepare(`SELECT COUNT(1) AS n, MAX(date) AS d FROM price_points WHERE provider = 'yahoo' AND symbol = ?`)
    .get(sym) as { n: number; d: string | null } | undefined;

  const count = cached?.n ?? 0;
  const latest = cached?.d ?? null;
  if (count >= 200 && latest) {
    const latestMs = Date.parse(`${latest}T00:00:00Z`);
    const throughMs = Date.parse(`${through}T00:00:00Z`);
    if (Number.isFinite(latestMs) && Number.isFinite(throughMs) && throughMs - latestMs <= 4 * 86_400_000) return;
  }

  const chart = await fetchYahooDailyChart(sym, "10y");
  if (!chart?.result) {
    logError(`benchmark_yahoo_empty_${sym}`, new Error("Yahoo daily chart unavailable"));
    return;
  }

  const bars = closesFromYahooChartResult(chart.result);
  if (bars.length === 0) {
    logError(`benchmark_yahoo_empty_${sym}`, new Error("Yahoo daily chart had no closes"));
    return;
  }

  const upsert = db.prepare(`
    INSERT INTO price_points (provider, symbol, date, close)
    VALUES ('yahoo', @symbol, @date, @close)
    ON CONFLICT(provider, symbol, date) DO UPDATE SET close = excluded.close
  `);
  const tx = db.transaction(() => {
    for (const bar of bars) upsert.run({ symbol: sym, date: bar.date, close: bar.close });
  });
  tx();
}

export function getCachedBenchmarkSeries(symbol: string): Array<{ date: string; close: number }> {
  const db = getDb();
  return db
    .prepare(
      `
      SELECT date, close
      FROM price_points
      WHERE provider='schwab' AND symbol = ?
      ORDER BY date ASC
    `,
    )
    .all(symbol) as Array<{ date: string; close: number }>;
}


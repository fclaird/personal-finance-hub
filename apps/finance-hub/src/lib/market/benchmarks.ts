import { getDb } from "@/lib/db";
import { logError } from "@/lib/log";
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

/**
 * Cache daily closes for benchmarks (SPY/QQQ). Tries 20y, then 5y, then 1y if Schwab returns no candles.
 */
export async function ensureBenchmarkHistory(symbol: string): Promise<void> {
  const db = getDb();

  const cachedCount = db
    .prepare(`SELECT COUNT(1) AS n FROM price_points WHERE provider='schwab' AND symbol = ?`)
    .get(symbol) as { n: number } | undefined;

  if ((cachedCount?.n ?? 0) >= 1500) return;

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


import type Database from "better-sqlite3";

import { normalizeEquitySymbol } from "@/lib/market/equityMarkPrice";
import { fetchYahooDailyChart, yahooChartSymbol } from "@/lib/market/yahooChartFetch";

function asNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  return null;
}

function yahooLastBarClose(result: Record<string, unknown>): number | null {
  const quote = (result.indicators as Record<string, unknown> | undefined)?.quote as
    | Array<Record<string, unknown>>
    | undefined;
  const closes = (quote?.[0]?.close as Array<number | null> | undefined) ?? [];
  for (let i = closes.length - 1; i >= 0; i--) {
    const c = closes[i];
    if (c != null && Number.isFinite(c) && c > 0) return c;
  }
  return null;
}

/** Extract latest NAV/price from a Yahoo daily chart payload. */
export function navFromYahooChartResult(result: Record<string, unknown>): number | null {
  const meta = result.meta as Record<string, unknown> | undefined;
  return (
    asNum(meta?.regularMarketPrice) ??
    asNum(meta?.postMarketPrice) ??
    asNum(meta?.preMarketPrice) ??
    yahooLastBarClose(result)
  );
}

/** Fetch one symbol's latest NAV via Yahoo chart API. */
export async function fetchYahooLatestPrice(symbol: string): Promise<number | null> {
  const chart = await fetchYahooDailyChart(symbol, "5d");
  if (!chart?.result) return null;
  return navFromYahooChartResult(chart.result);
}

/** Batch-fetch Yahoo NAV for symbols (sequential; shares global Yahoo throttle). */
export async function fetchYahooLatestPrices(symbols: Iterable<string>): Promise<Map<string, number>> {
  const uniq = [...new Set([...symbols].map(normalizeEquitySymbol).filter(Boolean))];
  const out = new Map<string, number>();
  for (const sym of uniq) {
    const px = await fetchYahooLatestPrice(sym);
    if (px != null) out.set(sym, px);
  }
  return out;
}

/** Latest cached Yahoo close per symbol from `price_points`. */
export function loadYahooPricePointsMap(db: Database.Database, symbols: Iterable<string>): Map<string, number> {
  const keys = [...new Set([...symbols].map(normalizeEquitySymbol).filter(Boolean))];
  if (keys.length === 0) return new Map();

  const placeholders = keys.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `
      SELECT pp.symbol AS symbol, pp.close AS close
      FROM price_points pp
      INNER JOIN (
        SELECT symbol, MAX(date) AS date
        FROM price_points
        WHERE provider = 'yahoo' AND symbol IN (${placeholders})
        GROUP BY symbol
      ) latest ON latest.symbol = pp.symbol AND latest.date = pp.date
      WHERE pp.provider = 'yahoo'
    `,
    )
    .all(...keys) as Array<{ symbol: string; close: number }>;

  const out = new Map<string, number>();
  for (const r of rows) {
    const key = normalizeEquitySymbol(r.symbol);
    if (key && Number.isFinite(r.close) && r.close > 0) out.set(key, r.close);
  }
  return out;
}

export function persistYahooPricePoints(
  db: Database.Database,
  marks: Map<string, number>,
  date: string = new Date().toISOString().slice(0, 10),
): number {
  const upsert = db.prepare(`
    INSERT INTO price_points (provider, symbol, date, close)
    VALUES ('yahoo', @symbol, @date, @close)
    ON CONFLICT(provider, symbol, date) DO UPDATE SET close = excluded.close, created_at = datetime('now')
  `);
  let n = 0;
  for (const [sym, px] of marks) {
    if (px > 0) {
      upsert.run({ symbol: yahooChartSymbol(sym), date, close: px });
      n++;
    }
  }
  return n;
}

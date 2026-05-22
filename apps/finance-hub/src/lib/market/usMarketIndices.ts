import { logError } from "@/lib/log";
import { ensureCandles, getCachedCandles } from "@/lib/terminal/ohlcv";
import { fetchYahooIntradayChart, yahooChartSymbol } from "@/lib/market/yahooChartFetch";
import { ensureBenchmarkHistory, getCachedBenchmarkSeries } from "@/lib/market/benchmarks";
import { schwabQuoteDisplayPrice } from "@/lib/market/schwabQuoteDisplay";
import { fetchSchwabQuotesResponse } from "@/lib/schwab/quotesFetch";
import { schwabQuoteObjectFromEntry } from "@/lib/schwab/quoteEntry";

export type UsMarketIndexId = "sp500" | "nasdaq" | "russell2000";

export type UsMarketIndexDefinition = {
  id: UsMarketIndexId;
  label: string;
  /** ETF proxy quoted on Schwab/Yahoo (SPY, QQQ, IWM). */
  symbol: string;
};

export const US_MARKET_INDEXES: UsMarketIndexDefinition[] = [
  { id: "sp500", label: "S&P 500", symbol: "SPY" },
  { id: "nasdaq", label: "Nasdaq", symbol: "QQQ" },
  { id: "russell2000", label: "Russell 2000", symbol: "IWM" },
];

export type UsMarketIndexCard = {
  id: UsMarketIndexId;
  label: string;
  symbol: string;
  last: number | null;
  change: number | null;
  changePct: number | null;
  previousClose: number | null;
  series: Array<{ idx: number; close: number }>;
  dataSource: "yahoo" | "schwab" | "mixed";
};

function asNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

function parseYahooIntraday(result: Record<string, unknown>): {
  last: number | null;
  previousClose: number | null;
  series: Array<{ idx: number; close: number }>;
} {
  const meta = result.meta as Record<string, unknown> | undefined;
  const quote = (result.indicators as Record<string, unknown> | undefined)?.quote as
    | Array<Record<string, unknown>>
    | undefined;
  const q0 = quote?.[0];
  const closes = (q0?.close as Array<number | null> | undefined) ?? [];
  const timestamps = (result.timestamp as number[] | undefined) ?? [];

  const points: Array<{ idx: number; close: number }> = [];
  for (let i = 0; i < closes.length; i++) {
    const c = closes[i];
    if (c == null || !Number.isFinite(c)) continue;
    points.push({ idx: points.length, close: c });
  }

  const lastFromSeries = points.length > 0 ? points[points.length - 1]!.close : null;
  const last =
    asNum(meta?.regularMarketPrice) ??
    asNum(meta?.regularMarketPreviousClose) ??
    lastFromSeries;
  const previousClose =
    asNum(meta?.chartPreviousClose) ??
    asNum(meta?.previousClose) ??
    (points.length > 1 ? points[0]!.close : null);

  return { last, previousClose, series: points };
}

async function schwabQuoteForSymbol(symbol: string): Promise<{
  last: number | null;
  change: number | null;
  changePercent: number | null;
  previousClose: number | null;
}> {
  try {
    const resp = await fetchSchwabQuotesResponse([symbol]);
    const entry = resp[symbol] ?? resp[symbol.toUpperCase()];
    const q = schwabQuoteObjectFromEntry(entry);
    if (!q) {
      return { last: null, change: null, changePercent: null, previousClose: null };
    }
    const rawLast = asNum(q.lastPrice);
    const mark = asNum(q.mark);
    const close = asNum(q.closePrice);
    const last = schwabQuoteDisplayPrice(rawLast, mark, close);
    const change = asNum(q.netChange ?? q.change) ?? (last != null && close != null ? last - close : null);
    const changePercent =
      asNum(q.netPercentChangeInDouble ?? q.changePercent) ??
      (change != null && close != null && close !== 0 ? change / close : null);
    return { last, change, changePercent, previousClose: close };
  } catch (e) {
    logError(`us_market_schwab_quote_${symbol}`, e);
    return { last: null, change: null, changePercent: null, previousClose: null };
  }
}

async function schwabIntradaySeries(symbol: string): Promise<Array<{ idx: number; close: number }>> {
  try {
    await ensureCandles(symbol, "5m", "1D");
    const since = Date.now() - 2 * 24 * 60 * 60 * 1000;
    const candles = getCachedCandles(symbol, "5m", since);
    if (candles.length >= 2) {
      return candles.map((c, idx) => ({ idx, close: c.close }));
    }
    await ensureBenchmarkHistory(symbol);
    const daily = getCachedBenchmarkSeries(symbol).slice(-30);
    return daily.map((d, idx) => ({ idx, close: d.close }));
  } catch (e) {
    logError(`us_market_schwab_series_${symbol}`, e);
    return [];
  }
}

async function buildIndexCard(def: UsMarketIndexDefinition): Promise<UsMarketIndexCard> {
  const sym = def.symbol.toUpperCase();
  let last: number | null = null;
  let change: number | null = null;
  let changePct: number | null = null;
  let previousClose: number | null = null;
  let series: Array<{ idx: number; close: number }> = [];
  let dataSource: UsMarketIndexCard["dataSource"] = "yahoo";

  const yahoo = await fetchYahooIntradayChart(sym);
  if (yahoo?.result) {
    const parsed = parseYahooIntraday(yahoo.result);
    last = parsed.last;
    previousClose = parsed.previousClose;
    series = parsed.series;
    if (last != null && previousClose != null && previousClose !== 0) {
      change = last - previousClose;
      changePct = (change / previousClose) * 100;
    }
  }

  if (last == null || series.length < 2) {
    const schwabQ = await schwabQuoteForSymbol(sym);
    if (last == null) {
      last = schwabQ.last;
      change = schwabQ.change;
      changePct = schwabQ.changePercent == null ? null : schwabQ.changePercent * 100;
      previousClose = schwabQ.previousClose;
      dataSource = series.length >= 2 ? "mixed" : "schwab";
    } else {
      dataSource = "mixed";
    }
    if (series.length < 2) {
      const schwabSeries = await schwabIntradaySeries(sym);
      if (schwabSeries.length >= 2) {
        series = schwabSeries;
      }
    }
  }

  if (change == null && last != null && previousClose != null && previousClose !== 0) {
    change = last - previousClose;
    changePct = (change / previousClose) * 100;
  }

  return {
    id: def.id,
    label: def.label,
    symbol: yahooChartSymbol(sym),
    last,
    change,
    changePct,
    previousClose,
    series,
    dataSource,
  };
}

export async function fetchUsMarketIndexCards(): Promise<UsMarketIndexCard[]> {
  const cards: UsMarketIndexCard[] = [];
  for (const def of US_MARKET_INDEXES) {
    cards.push(await buildIndexCard(def));
  }
  return cards;
}

/** Warm Schwab daily history for index ETF proxies (backup path). */
export async function ensureUsMarketIndexBenchmarks(): Promise<void> {
  for (const def of US_MARKET_INDEXES) {
    try {
      await ensureBenchmarkHistory(def.symbol);
    } catch (e) {
      logError(`us_market_benchmark_${def.symbol}`, e);
    }
  }
}

import { logError } from "@/lib/log";
import {
  filterYahooClosesToSession,
  glanceSessionYmd,
  isoDateInUsEastern,
  schwabIntradayWindowForGlance,
  toIndexedSeries,
  yahooIntradayRangeForGlance,
} from "@/lib/market/glanceSession";
import { ensureCandles, getCachedCandles, type CandleWindow } from "@/lib/terminal/ohlcv";
import { fetchYahooIntradayChart, yahooChartSymbol } from "@/lib/market/yahooChartFetch";
import { ensureBenchmarkHistory, getCachedBenchmarkSeries } from "@/lib/market/benchmarks";
import { schwabQuoteDisplayPrice } from "@/lib/market/schwabQuoteDisplay";
import { fetchSchwabQuotesResponse } from "@/lib/schwab/quotesFetch";
import { schwabQuoteObjectFromEntry } from "@/lib/schwab/quoteEntry";

export type UsMarketIndexId = "sp500" | "nasdaq" | "russell2000";

export type UsMarketIndexDefinition = {
  id: UsMarketIndexId;
  label: string;
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

function computeDayChange(last: number | null, previousClose: number | null): { change: number | null; changePct: number | null } {
  if (last == null || previousClose == null || previousClose === 0) {
    return { change: null, changePct: null };
  }
  const change = last - previousClose;
  return { change, changePct: (change / previousClose) * 100 };
}

function seriesPriceRange(series: Array<{ close: number }>): number {
  if (series.length === 0) return 0;
  let min = Infinity;
  let max = -Infinity;
  for (const p of series) {
    min = Math.min(min, p.close);
    max = Math.max(max, p.close);
  }
  return max - min;
}

function seriesIsFlat(series: Array<{ close: number }>, refPrice: number | null): boolean {
  if (series.length < 2) return true;
  const ref = Math.max(Math.abs(refPrice ?? series[0]!.close ?? 1), 1e-9);
  return seriesPriceRange(series) / ref < 0.00005;
}

export function normalizeSeriesForChart(
  series: Array<{ idx: number; close: number }>,
  previousClose: number | null,
  last: number | null,
): Array<{ idx: number; close: number }> {
  let out = series.map((p, i) => ({ idx: i, close: p.close }));

  if (out.length === 0 && previousClose != null && last != null) {
    return [
      { idx: 0, close: previousClose },
      { idx: 1, close: last },
    ];
  }

  if (previousClose != null && out.length > 0) {
    const head = out[0]!.close;
    const ref = Math.max(Math.abs(previousClose), 1e-9);
    if (Math.abs(head - previousClose) / ref > 0.00005) {
      out = [{ idx: 0, close: previousClose }, ...out.map((p, i) => ({ idx: i + 1, close: p.close }))];
    }
  }

  if (last != null && out.length > 0) {
    const tail = out[out.length - 1]!.close;
    const ref = Math.max(Math.abs(last), 1e-9);
    if (Math.abs(tail - last) / ref > 0.00005) {
      out = [...out, { idx: out.length, close: last }];
    }
  }

  if (out.length === 1 && previousClose != null && last != null) {
    return [
      { idx: 0, close: previousClose },
      { idx: 1, close: last },
    ];
  }

  return out.map((p, i) => ({ idx: i, close: p.close }));
}

function parseYahooIntraday(
  result: Record<string, unknown>,
  sessionYmd: string,
): {
  last: number | null;
  previousClose: number | null;
  series: Array<{ idx: number; close: number }>;
} {
  const meta = result.meta as Record<string, unknown> | undefined;
  const series = filterYahooClosesToSession(result, sessionYmd);
  const lastFromSeries = series.length > 0 ? series[series.length - 1]!.close : null;

  return {
    last: lastFromSeries ?? asNum(meta?.regularMarketPrice),
    previousClose:
      asNum(meta?.chartPreviousClose) ??
      asNum(meta?.previousClose) ??
      asNum(meta?.regularMarketPreviousClose) ??
      null,
    series,
  };
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

async function schwabIntradaySeries(
  symbol: string,
  sessionYmd: string,
  window: CandleWindow,
): Promise<Array<{ idx: number; close: number }>> {
  try {
    await ensureCandles(symbol, "5m", window);
    const since = Date.now() - (window === "5D" ? 8 : 2) * 24 * 60 * 60 * 1000;
    const candles = getCachedCandles(symbol, "5m", since);
    if (candles.length >= 2) {
      const session = candles.filter((c) => isoDateInUsEastern(c.tsMs) === sessionYmd);
      const use = session.length >= 2 ? session : candles.slice(-78);
      return toIndexedSeries(use.map((c) => c.close));
    }
    await ensureBenchmarkHistory(symbol);
    const daily = getCachedBenchmarkSeries(symbol).slice(-10);
    const sessionDaily = daily.filter((d) => d.date === sessionYmd);
    const useDaily = sessionDaily.length >= 1 ? sessionDaily : daily.slice(-1);
    return toIndexedSeries(useDaily.map((d) => d.close));
  } catch (e) {
    logError(`us_market_schwab_series_${symbol}`, e);
    return [];
  }
}

async function buildIndexCard(def: UsMarketIndexDefinition, sessionYmd: string, now: Date): Promise<UsMarketIndexCard> {
  const sym = def.symbol.toUpperCase();
  let last: number | null = null;
  let previousClose: number | null = null;
  let series: Array<{ idx: number; close: number }> = [];
  let dataSource: UsMarketIndexCard["dataSource"] = "yahoo";

  const yahooRange = yahooIntradayRangeForGlance(now);
  const schwabWindow = schwabIntradayWindowForGlance(now);

  const yahoo = await fetchYahooIntradayChart(sym, yahooRange);
  if (yahoo?.result) {
    const parsed = parseYahooIntraday(yahoo.result, sessionYmd);
    last = parsed.last;
    previousClose = parsed.previousClose;
    series = parsed.series;
  }

  const schwabQ = await schwabQuoteForSymbol(sym);
  if (last == null) last = schwabQ.last;
  if (previousClose == null) previousClose = schwabQ.previousClose;

  if (series.length === 0 || seriesIsFlat(series, previousClose ?? last)) {
    const schwabSeries = await schwabIntradaySeries(sym, sessionYmd, schwabWindow);
    if (!seriesIsFlat(schwabSeries, previousClose ?? last)) {
      series = schwabSeries;
      dataSource = yahoo?.result ? "mixed" : "schwab";
    }
  }

  if (last == null && schwabQ.last != null) {
    last = schwabQ.last;
    dataSource = "schwab";
  }

  if (last == null && series.length > 0) {
    last = series[series.length - 1]!.close;
  }

  series = normalizeSeriesForChart(series, previousClose, last);
  const dayChange = computeDayChange(last, previousClose);

  return {
    id: def.id,
    label: def.label,
    symbol: yahooChartSymbol(sym),
    last,
    change: dayChange.change,
    changePct: dayChange.changePct,
    previousClose,
    series,
    dataSource,
  };
}

export async function fetchUsMarketIndexCards(now: Date = new Date()): Promise<UsMarketIndexCard[]> {
  const sessionYmd = glanceSessionYmd(now);
  const cards: UsMarketIndexCard[] = [];
  for (const def of US_MARKET_INDEXES) {
    cards.push(await buildIndexCard(def, sessionYmd, now));
  }
  return cards;
}

export async function ensureUsMarketIndexBenchmarks(): Promise<void> {
  for (const def of US_MARKET_INDEXES) {
    try {
      await ensureBenchmarkHistory(def.symbol);
    } catch (e) {
      logError(`us_market_benchmark_${def.symbol}`, e);
    }
  }
}

export function indexChangePctFromCards(cards: UsMarketIndexCard[], symbol: string): number | null {
  const sym = symbol.trim().toUpperCase();
  const card = cards.find((c) => {
    const def = US_MARKET_INDEXES.find((d) => d.id === c.id);
    return c.symbol.toUpperCase() === sym || def?.symbol === sym;
  });
  return card?.changePct ?? null;
}

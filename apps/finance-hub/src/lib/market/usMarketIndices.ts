import { logError } from "@/lib/log";
import type { FuturesGlanceKind } from "@/lib/market/futuresGlanceSession";
import {
  buildExtendedFallbackSeries,
  computeExtendedChange,
  extractYahooTimedCloses,
  glanceChartContext,
  nyBarPhase,
  resolveGlanceSplitContext,
  splitTimedPointsForGlance,
} from "@/lib/market/glanceExtendedHours";
import {
  buildAlignedExtendedSeries,
  extendedPhaseForGrid,
  resampleTimedPointsToGrid,
  toGlanceSeries,
  type GlanceTimedGrid,
} from "@/lib/market/glanceSessionGrid";
import { filterTimedPointsForGlanceSession } from "@/lib/market/glanceTimedFilters";
import {
  filterYahooClosesToSession,
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
  { id: "nasdaq", label: "Nasdaq", symbol: "QQQ" },
  { id: "sp500", label: "S&P 500", symbol: "SPY" },
];

/** Russell 2000 is shown on the Futures quick-glance tab (IWM). */
export const RUSSELL_2000_INDEX: UsMarketIndexDefinition = {
  id: "russell2000",
  label: "Russell 2000",
  symbol: "IWM",
};

export type GlanceValueMode = "price" | "percent";

export type GlanceInstrumentKind = "future" | "cash_index";

export type UsMarketIndexCard = {
  id: string;
  label: string;
  symbol: string;
  last: number | null;
  change: number | null;
  changePct: number | null;
  previousClose: number | null;
  series: Array<{ idx: number; close: number }>;
  dataSource: "yahoo" | "schwab" | "mixed";
  /** Indexed tiles use percent labels; portfolio also exposes netValue in dollars. */
  valueMode?: GlanceValueMode;
  netValue?: number | null;
  priorNetValue?: number | null;
  /** CME Globex futures tiles (ES, NQ, CL). */
  futuresKind?: FuturesGlanceKind;
  /** Cash index tiles (e.g. Nikkei ^N225) — not futures. */
  instrumentKind?: GlanceInstrumentKind;
  tradableOpen?: boolean;
} & GlanceExtendedFields;

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

/** Schwab quote fields use the same prior-close basis as the terminal quotes table. */
export function resolveSchwabAnchoredDayMetrics(
  schwabQ: {
    last: number | null;
    change: number | null;
    changePercent: number | null;
    previousClose: number | null;
  },
  fallbackLast: number | null,
  fallbackPreviousClose: number | null,
): {
  last: number | null;
  previousClose: number | null;
  change: number | null;
  changePct: number | null;
} {
  const previousClose = schwabQ.previousClose ?? fallbackPreviousClose;
  const last = schwabQ.last ?? fallbackLast;
  const fromPrices = computeDayChange(last, previousClose);

  if (
    schwabQ.changePercent != null &&
    Number.isFinite(schwabQ.changePercent) &&
    schwabQ.previousClose != null &&
    schwabQ.last != null
  ) {
    return {
      last,
      previousClose,
      change: schwabQ.change ?? fromPrices.change,
      changePct: schwabQ.changePercent * 100,
    };
  }

  return {
    last,
    previousClose,
    change: fromPrices.change,
    changePct: fromPrices.changePct,
  };
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
  series: Array<{ idx: number; close: number; tsMs?: number }>,
  previousClose: number | null,
  last: number | null,
): Array<{ idx: number; close: number; tsMs?: number }> {
  let out = series.map((p, i) => ({ idx: i, close: p.close, tsMs: p.tsMs }));

  // No intraday bars — fall back to prior close → last (day change only).
  if (out.length === 0 && previousClose != null && last != null) {
    return [
      { idx: 0, close: previousClose },
      { idx: 1, close: last },
    ] as Array<{ idx: number; close: number; tsMs?: number }>;
  }

  if (last != null && out.length > 0) {
    const tail = out[out.length - 1]!.close;
    const ref = Math.max(Math.abs(last), 1e-9);
    if (Math.abs(tail - last) / ref > 0.00005) {
      out = [...out, { idx: out.length, close: last, tsMs: undefined }];
    }
  }

  // Single intraday point: anchor at open (first bar), not prior close.
  if (out.length === 1 && last != null) {
    const open = out[0]!.close;
    const ref = Math.max(Math.abs(last), 1e-9);
    if (Math.abs(open - last) / ref > 0.00005) {
      return [
        { idx: 0, close: open },
        { idx: 1, close: last },
      ] as Array<{ idx: number; close: number; tsMs?: number }>;
    }
  }

  return out.map((p, i) => ({ idx: i, close: p.close, tsMs: p.tsMs }));
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
): Promise<Array<{ idx: number; close: number; tsMs?: number }>> {
  try {
    await ensureCandles(symbol, "5m", window);
    const since = Date.now() - (window === "5D" ? 8 : 2) * 24 * 60 * 60 * 1000;
    const candles = getCachedCandles(symbol, "5m", since);
    if (candles.length >= 2) {
      const session = candles.filter(
        (c) => isoDateInUsEastern(c.tsMs) === sessionYmd && nyBarPhase(c.tsMs, sessionYmd) === "regular",
      );
      const use = session.length >= 2 ? session : candles.slice(-78);
      return use.map((c, idx) => ({ idx, close: c.close, tsMs: c.tsMs }));
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

function schwabTimedPoints(
  symbol: string,
  sessionYmd: string,
  window: CandleWindow,
  phase: "regular" | GlanceExtendedPhase,
): TimedClosePoint[] {
  const since = Date.now() - (window === "5D" ? 8 : 2) * 24 * 60 * 60 * 1000;
  const candles = getCachedCandles(symbol, "5m", since);
  return candles
    .filter((c) => isoDateInUsEastern(c.tsMs) === sessionYmd && nyBarPhase(c.tsMs, sessionYmd) === phase)
    .map((c) => ({ tsMs: c.tsMs, close: c.close }));
}

export async function buildSymbolGlanceCard(
  params: { id: string; label: string; symbol: string },
  now: Date = new Date(),
  grid?: GlanceTimedGrid,
): Promise<UsMarketIndexCard> {
  return buildIndexCard(
    { id: params.id as UsMarketIndexId, label: params.label, symbol: params.symbol },
    now,
    grid,
  );
}

async function buildIndexCard(
  def: UsMarketIndexDefinition | { id: string; label: string; symbol: string },
  now: Date = new Date(),
  grid?: GlanceTimedGrid,
): Promise<UsMarketIndexCard> {
  const ctx = glanceChartContext(now);
  const sessionYmd = ctx.sessionYmd;
  const sym = def.symbol.toUpperCase();
  let last: number | null = null;
  let previousClose: number | null = null;
  let series: Array<{ idx: number; close: number; tsMs?: number }> = [];
  let extendedSeries: Array<{ idx: number; close: number; tsMs?: number }> = [];
  let sessionClose: number | null = null;
  let extendedPhase: GlanceExtendedPhase | null = ctx.extendedPhase;
  let dataSource: UsMarketIndexCard["dataSource"] = "yahoo";

  const yahooRange = ctx.showExtended ? "5d" : yahooIntradayRangeForGlance(now);
  const schwabWindow = schwabIntradayWindowForGlance(now);
  const includePrePost = ctx.showExtended || yahooRange === "5d" || grid != null;

  if (grid && grid.regular.length >= 1) {
    const extPhase = extendedPhaseForGrid(grid) ?? ctx.extendedPhase ?? "post";
    let regularTimed: TimedClosePoint[] = [];
    let extendedTimed: TimedClosePoint[] = [];

    const yahooGrid = await fetchYahooIntradayChart(sym, "5d", { includePrePost: true });
    if (yahooGrid?.result) {
      const timed = filterTimedPointsForGlanceSession(extractYahooTimedCloses(yahooGrid.result), sessionYmd, ctx);
      regularTimed = timed.filter((p) => nyBarPhase(p.tsMs, sessionYmd) === "regular");
      extendedTimed = timed.filter((p) => nyBarPhase(p.tsMs, ctx.chartYmd) === extPhase);
      const meta = yahooGrid.result.meta as Record<string, unknown> | undefined;
      previousClose =
        asNum(meta?.chartPreviousClose) ??
        asNum(meta?.previousClose) ??
        asNum(meta?.regularMarketPreviousClose) ??
        null;
      last =
        ctx.showExtended && extendedTimed.length > 0
          ? extendedTimed[extendedTimed.length - 1]!.close
          : regularTimed.length > 0
            ? regularTimed[regularTimed.length - 1]!.close
            : asNum(meta?.postMarketPrice) ?? asNum(meta?.regularMarketPrice);
    }

    if (regularTimed.length < 2) {
      await ensureCandles(sym, "5m", schwabWindow);
      regularTimed = schwabTimedPoints(sym, sessionYmd, schwabWindow, "regular");
      if (ctx.showExtended && (grid.extended.length > 0 || extPhase === "pre")) {
        extendedTimed = schwabTimedPoints(
          sym,
          extPhase === "pre" ? ctx.chartYmd : sessionYmd,
          schwabWindow,
          extPhase,
        );
      }
      if (regularTimed.length >= 2) dataSource = yahooGrid?.result ? "mixed" : "schwab";
    }

    const resampledRegular = resampleTimedPointsToGrid(regularTimed, grid.regular);
    series = toGlanceSeries(resampledRegular);
    sessionClose = series.length > 0 ? series[series.length - 1]!.close : null;

    if (ctx.showExtended && grid.extended.length > 0 && sessionClose != null) {
      const resampledExt = resampleTimedPointsToGrid(extendedTimed, grid.extended);
      extendedSeries = buildAlignedExtendedSeries(series, resampledExt, sessionClose);
      extendedPhase = extPhase;
    } else if (
      ctx.showExtended &&
      extendedSeries.length === 0 &&
      extendedTimed.length >= 2 &&
      sessionClose != null
    ) {
      extendedSeries = buildAlignedExtendedSeries(
        series,
        extendedTimed.map((p) => ({ tsMs: p.tsMs, close: p.close })),
        sessionClose,
      );
      extendedPhase = extPhase;
    }
  }

  const yahoo = grid ? null : await fetchYahooIntradayChart(sym, yahooRange, { includePrePost });
  if (yahoo?.result) {
    const timed = extractYahooTimedCloses(yahoo.result);
    const splitCtx = resolveGlanceSplitContext(ctx, timed, now);
    const split = splitTimedPointsForGlance(timed, splitCtx);
    series = split.regular;
    extendedSeries = split.extended;
    sessionClose = split.sessionClose;
    if (splitCtx.extendedPhase) extendedPhase = splitCtx.extendedPhase;

    const meta = yahoo.result.meta as Record<string, unknown> | undefined;
    previousClose =
      asNum(meta?.chartPreviousClose) ??
      asNum(meta?.previousClose) ??
      asNum(meta?.regularMarketPreviousClose) ??
      null;
    last =
      extendedSeries.length > 0
        ? extendedSeries[extendedSeries.length - 1]!.close
        : series.length > 0
          ? series[series.length - 1]!.close
          : asNum(meta?.postMarketPrice) ?? asNum(meta?.regularMarketPrice);
  }

  const alignedToGrid = grid != null && grid.regular.length >= 1 && series.length >= 1;

  const schwabQ = await schwabQuoteForSymbol(sym);
  if (last == null) last = schwabQ.last;
  if (previousClose == null) previousClose = schwabQ.previousClose;

  if (!alignedToGrid && (series.length === 0 || seriesIsFlat(series, previousClose ?? last))) {
    const schwabSeries = await schwabIntradaySeries(sym, sessionYmd, schwabWindow);
    if (!seriesIsFlat(schwabSeries, previousClose ?? last)) {
      series = schwabSeries;
      dataSource = yahoo?.result ? "mixed" : "schwab";
      if (sessionClose == null && series.length > 0) {
        sessionClose = series[series.length - 1]!.close;
      }
    }
  }

  if (last == null && schwabQ.last != null) {
    last = schwabQ.last;
    dataSource = "schwab";
  }

  if (last == null && series.length > 0) {
    last = series[series.length - 1]!.close;
  }

  if (sessionClose == null && series.length > 0) {
    sessionClose = series[series.length - 1]!.close;
  }

  if (ctx.showExtended && extendedSeries.length === 0 && sessionClose != null && last != null) {
    if (alignedToGrid) {
      const yahooExt = await fetchYahooIntradayChart(sym, "5d", { includePrePost: true });
      if (yahooExt?.result) {
        const timed = filterTimedPointsForGlanceSession(extractYahooTimedCloses(yahooExt.result), sessionYmd, ctx);
        const splitCtx = resolveGlanceSplitContext(ctx, timed, now);
        const split = splitTimedPointsForGlance(timed, splitCtx);
        if (split.extended.length >= 2) {
          extendedSeries = split.extended;
          if (splitCtx.extendedPhase) extendedPhase = splitCtx.extendedPhase;
        }
      }
    }
    if (extendedSeries.length === 0) {
      extendedSeries = buildExtendedFallbackSeries(series, sessionClose, last, now);
      if (extendedSeries.length >= 2 && extendedPhase == null) {
        extendedPhase = ctx.extendedPhase ?? "post";
      }
    }
  }

  const anchored = resolveSchwabAnchoredDayMetrics(schwabQ, last, previousClose);
  last = anchored.last;
  previousClose = anchored.previousClose;

  const regularAnchor = sessionClose ?? series.at(-1)?.close ?? null;
  series = normalizeSeriesForChart(series, previousClose, regularAnchor);

  if (!ctx.showExtended) {
    extendedSeries = [];
    extendedPhase = null;
  }

  const dayChange = { change: anchored.change, changePct: anchored.changePct };
  const extendedLast = extendedSeries.length >= 2 ? last : null;
  const ext = computeExtendedChange(sessionClose, extendedLast);

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
    extendedSeries: extendedSeries.length >= 2 ? extendedSeries : undefined,
    sessionClose,
    extendedLast,
    extendedChange: ext.extendedChange,
    extendedChangePct: ext.extendedChangePct,
    extendedPhase: extendedSeries.length >= 2 ? extendedPhase : null,
  };
}

export async function fetchUsMarketIndexCards(
  now: Date = new Date(),
  grid?: GlanceTimedGrid,
): Promise<UsMarketIndexCard[]> {
  const cards: UsMarketIndexCard[] = [];
  for (const def of US_MARKET_INDEXES) {
    cards.push(await buildIndexCard(def, now, grid));
  }
  return cards;
}

export async function ensureUsMarketIndexBenchmarks(): Promise<void> {
  for (const def of [...US_MARKET_INDEXES, RUSSELL_2000_INDEX]) {
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
    const def = [...US_MARKET_INDEXES, RUSSELL_2000_INDEX].find((d) => d.id === c.id);
    return c.symbol.toUpperCase() === sym || def?.symbol === sym;
  });
  return card?.changePct ?? null;
}

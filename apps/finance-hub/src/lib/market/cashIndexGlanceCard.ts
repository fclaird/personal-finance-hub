import {
  buildExtendedFallbackSeries,
  computeExtendedChange,
  extractYahooTimedCloses,
} from "@/lib/market/glanceExtendedHours";
import {
  isLondonCashSessionOpen,
  isTokyoCashSessionOpen,
  londonGlanceChartContext,
  resolveLondonSplitContext,
  resolveTokyoSplitContext,
  splitTimedPointsForCashIndexGlance,
  splitTimedPointsForLondonCashIndexGlance,
  tokyoGlanceChartContext,
} from "@/lib/market/cashIndexGlanceSession";
import type { RegionalMarketInstrument } from "@/lib/market/regionalMarketInstruments";
import { normalizeSeriesForChart, type UsMarketIndexCard } from "@/lib/market/usMarketIndices";
import { fetchYahooIntradayChart, yahooChartSymbol } from "@/lib/market/yahooChartFetch";

function asNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function computeDayChange(last: number | null, previousClose: number | null): {
  change: number | null;
  changePct: number | null;
} {
  if (last == null || previousClose == null || previousClose === 0) {
    return { change: null, changePct: null };
  }
  const change = last - previousClose;
  return { change, changePct: (change / previousClose) * 100 };
}

export function isCashIndexInstrument(def: RegionalMarketInstrument): boolean {
  return (def.region === "jp" || def.region === "uk") && !def.yahooSymbol.endsWith("=F");
}

/** Cash index tile (Nikkei, FTSE 100): local RTH green, pre/post gray when Yahoo has bars. */
export async function buildCashIndexGlanceCard(
  def: RegionalMarketInstrument,
  now: Date = new Date(),
): Promise<UsMarketIndexCard> {
  const sym = def.yahooSymbol.toUpperCase();
  const isLondon = def.region === "uk";
  const ctx = isLondon ? londonGlanceChartContext(now) : tokyoGlanceChartContext(now);
  const yahoo = await fetchYahooIntradayChart(sym, "5d", { includePrePost: true });

  let series: UsMarketIndexCard["series"] = [];
  let extendedSeries: UsMarketIndexCard["extendedSeries"];
  let sessionClose: number | null = null;
  let extendedPhase = ctx.extendedPhase;
  let last: number | null = null;
  let previousClose: number | null = null;

  if (yahoo?.result) {
    const timed = extractYahooTimedCloses(yahoo.result);
    const splitCtx = isLondon
      ? resolveLondonSplitContext(ctx, timed)
      : resolveTokyoSplitContext(ctx, timed);
    const split = isLondon
      ? splitTimedPointsForLondonCashIndexGlance(timed, splitCtx)
      : splitTimedPointsForCashIndexGlance(timed, splitCtx);
    series = split.regular;
    extendedSeries = split.extended.length >= 2 ? split.extended : undefined;
    sessionClose = split.sessionClose;
    if (splitCtx.extendedPhase) extendedPhase = splitCtx.extendedPhase;

    const meta = yahoo.result.meta as Record<string, unknown> | undefined;
    previousClose =
      asNum(meta?.chartPreviousClose) ??
      asNum(meta?.previousClose) ??
      asNum(meta?.regularMarketPreviousClose) ??
      null;
    last =
      extendedSeries && extendedSeries.length > 0
        ? extendedSeries[extendedSeries.length - 1]!.close
        : split.last ??
          (series.length > 0 ? series[series.length - 1]!.close : null) ??
          asNum(meta?.postMarketPrice) ??
          asNum(meta?.regularMarketPrice);
  }

  if (extendedSeries == null && sessionClose != null && last != null) {
    const fallback = buildExtendedFallbackSeries(series, sessionClose, last, now);
    if (fallback.length >= 2) {
      extendedSeries = fallback;
      if (extendedPhase == null) extendedPhase = ctx.extendedPhase ?? "post";
    }
  }

  const anchor = sessionClose ?? series.at(-1)?.close ?? last;
  series = normalizeSeriesForChart(series, previousClose, anchor);

  const dayChange = computeDayChange(last, previousClose);
  let extendedChange: number | null = null;
  let extendedChangePct: number | null = null;
  if (extendedSeries && extendedSeries.length >= 2 && sessionClose != null) {
    const extCh = computeExtendedChange(sessionClose, extendedSeries[extendedSeries.length - 1]!.close);
    extendedChange = extCh.extendedChange;
    extendedChangePct = extCh.extendedChangePct;
  }

  return {
    id: def.id,
    label: def.label,
    symbol: yahooChartSymbol(sym),
    last,
    change: dayChange.change,
    changePct: dayChange.changePct,
    previousClose,
    series,
    dataSource: "yahoo",
    instrumentKind: "cash_index",
    tradableOpen: isLondon ? isLondonCashSessionOpen(now) : isTokyoCashSessionOpen(now),
    extendedSeries,
    sessionClose,
    extendedLast: extendedSeries?.[extendedSeries.length - 1]?.close ?? null,
    extendedChange,
    extendedChangePct,
    extendedPhase: extendedSeries ? extendedPhase : null,
  };
}

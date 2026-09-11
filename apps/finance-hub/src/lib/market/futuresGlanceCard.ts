import { computeExtendedChange, extractYahooTimedCloses } from "@/lib/market/glanceExtendedHours";
import {
  futuresGlanceKindForInstrument,
  isFuturesInstrumentTradable,
  splitTimedPointsForFuturesGlance,
} from "@/lib/market/futuresGlanceSession";
import {
  futuresGlanceDayChange,
  resolveFuturesGlancePreviousClose,
} from "@/lib/market/futuresGlancePreviousClose";
import type { RegionalMarketInstrument } from "@/lib/market/regionalMarketInstruments";
import { normalizeSeriesForChart, type UsMarketIndexCard } from "@/lib/market/usMarketIndices";
import { fetchYahooIntradayChart, yahooChartSymbol } from "@/lib/market/yahooChartFetch";

function asNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

export async function buildFuturesGlanceCard(
  def: RegionalMarketInstrument,
  now: Date = new Date(),
): Promise<UsMarketIndexCard> {
  const kind = futuresGlanceKindForInstrument(def);
  const sym = def.yahooSymbol.toUpperCase();
  const yahoo = await fetchYahooIntradayChart(sym, "5d", { includePrePost: true });

  let series: UsMarketIndexCard["series"] = [];
  let extendedSeries: UsMarketIndexCard["extendedSeries"];
  let sessionClose: number | null = null;
  let extendedPhase = null as UsMarketIndexCard["extendedPhase"];
  let last: number | null = null;
  let previousClose: number | null = null;

  if (yahoo?.result) {
    const timed = extractYahooTimedCloses(yahoo.result);
    const split = splitTimedPointsForFuturesGlance(timed, kind, def.region, now);
    series = split.regular;
    extendedSeries = split.extended.length >= 2 ? split.extended : undefined;
    sessionClose = split.sessionClose;
    extendedPhase = split.extendedPhase;
    last = split.last;

    const meta = yahoo.result.meta as Record<string, unknown> | undefined;
    previousClose = resolveFuturesGlancePreviousClose({
      meta,
      timed,
      kind,
      now,
    });
    if (last == null && series.length > 0) last = series[series.length - 1]!.close;
    if (last == null) last = asNum(meta?.regularMarketPrice) ?? asNum(meta?.postMarketPrice);
  }

  const anchor = sessionClose ?? series.at(-1)?.close ?? null;
  series = normalizeSeriesForChart(series, previousClose, anchor);

  const dayChange = futuresGlanceDayChange(last, previousClose);
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
    extendedSeries,
    sessionClose,
    extendedLast: extendedSeries?.[extendedSeries.length - 1]?.close ?? null,
    extendedChange,
    extendedChangePct,
    extendedPhase: extendedSeries ? extendedPhase : null,
    instrumentKind: "future",
    futuresKind: kind,
    tradableOpen: isFuturesInstrumentTradable(kind, def.region, now),
  };
}

export { futuresGlanceDayChange, resolveFuturesGlancePreviousClose } from "@/lib/market/futuresGlancePreviousClose";
export type { FuturesGlanceKind } from "@/lib/market/futuresGlanceSession";

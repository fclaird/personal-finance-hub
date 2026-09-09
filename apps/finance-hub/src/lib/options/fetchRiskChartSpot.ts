import { isUsEquityRegularSessionOpen } from "@/lib/market/usEquitySession";
import { fetchYahooDailyChart } from "@/lib/market/yahooChartFetch";
import { normalizeSchwabQuoteSymbol } from "@/lib/market/schwabSymbol";
import { fetchSchwabQuotesResponse } from "@/lib/schwab/quotesFetch";
import {
  bestAvailableSpotFromSchwabEntry,
  bestAvailableSpotFromYahooChartResult,
  samePrint,
  type RiskChartSpotSource,
} from "@/lib/options/riskChartSpot";

export type FetchedRiskChartSpot = {
  spot: number | null;
  source: RiskChartSpotSource | null;
};

/**
 * Live equity print for the Option Strategies PnL risk graphic only.
 * Schwab `/quotes` extended → quote last/mark → Yahoo post/pre/regular → null (caller uses OHLCV fallback).
 */
export async function fetchRiskChartSpot(
  symbol: string,
  now: Date = new Date(),
): Promise<FetchedRiskChartSpot> {
  const sym = normalizeSchwabQuoteSymbol(symbol);
  if (!sym) return { spot: null, source: null };
  const sessionOpen = isUsEquityRegularSessionOpen(now);

  try {
    const resp = await fetchSchwabQuotesResponse([sym]);
    const entry = resp[sym] ?? resp[sym.toUpperCase()];
    const schwab = bestAvailableSpotFromSchwabEntry(entry, sessionOpen);
    if (schwab.spot != null && schwab.source !== "schwab-close") {
      return { spot: schwab.spot, source: schwab.source };
    }
    if (schwab.spot != null && sessionOpen) {
      return { spot: schwab.spot, source: schwab.source };
    }

    try {
      const chart = await fetchYahooDailyChart(sym, "5d");
      const yahoo = bestAvailableSpotFromYahooChartResult(chart?.result ?? null, sessionOpen);
      if (yahoo != null && (schwab.close == null || !samePrint(yahoo, schwab.close))) {
        return { spot: yahoo, source: "yahoo" };
      }
      if (yahoo != null && schwab.spot == null) {
        return { spot: yahoo, source: "yahoo" };
      }
    } catch {
      /* Yahoo is optional */
    }

    if (schwab.spot != null) return { spot: schwab.spot, source: schwab.source };
  } catch {
    try {
      const chart = await fetchYahooDailyChart(sym, "5d");
      const yahoo = bestAvailableSpotFromYahooChartResult(chart?.result ?? null, sessionOpen);
      if (yahoo != null) return { spot: yahoo, source: "yahoo" };
    } catch {
      /* both vendors failed */
    }
  }

  return { spot: null, source: null };
}

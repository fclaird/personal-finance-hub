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
 * Live equity prints for the Option Strategies PnL risk graphic only.
 * Schwab `/quotes` extended → quote last/mark → Yahoo post/pre/regular → null (caller uses OHLCV fallback).
 * Works for any underlying — no ticker special-case.
 */
export async function fetchRiskChartSpots(
  symbols: Iterable<string>,
  now: Date = new Date(),
): Promise<Map<string, FetchedRiskChartSpot>> {
  const uniq = [...new Set([...symbols].map((s) => normalizeSchwabQuoteSymbol(s)).filter(Boolean))];
  const out = new Map<string, FetchedRiskChartSpot>();
  if (uniq.length === 0) return out;

  const sessionOpen = isUsEquityRegularSessionOpen(now);
  let resp: Record<string, unknown> = {};
  try {
    resp = await fetchSchwabQuotesResponse(uniq);
  } catch {
    resp = {};
  }

  const needYahoo: string[] = [];
  for (const sym of uniq) {
    const entry = resp[sym] ?? resp[sym.toUpperCase()];
    const schwab = bestAvailableSpotFromSchwabEntry(entry, sessionOpen);
    if (schwab.spot != null && schwab.source !== "schwab-close") {
      out.set(sym, { spot: schwab.spot, source: schwab.source });
      continue;
    }
    if (schwab.spot != null && sessionOpen) {
      out.set(sym, { spot: schwab.spot, source: schwab.source });
      continue;
    }
    needYahoo.push(sym);
    if (schwab.spot != null) out.set(sym, { spot: schwab.spot, source: schwab.source });
  }

  for (const sym of needYahoo) {
    const prior = out.get(sym);
    try {
      const chart = await fetchYahooDailyChart(sym, "5d");
      const yahoo = bestAvailableSpotFromYahooChartResult(chart?.result ?? null, sessionOpen);
      if (yahoo != null && (prior?.spot == null || prior.source === "schwab-close")) {
        const closeLike = prior?.spot;
        if (closeLike == null || !samePrint(yahoo, closeLike)) {
          out.set(sym, { spot: yahoo, source: "yahoo" });
          continue;
        }
      }
      if (yahoo != null && prior?.spot == null) {
        out.set(sym, { spot: yahoo, source: "yahoo" });
      }
    } catch {
      /* Yahoo is optional */
    }
  }

  for (const sym of uniq) {
    if (!out.has(sym)) out.set(sym, { spot: null, source: null });
  }
  return out;
}

export async function fetchRiskChartSpot(
  symbol: string,
  now: Date = new Date(),
): Promise<FetchedRiskChartSpot> {
  const key = normalizeSchwabQuoteSymbol(symbol);
  const map = await fetchRiskChartSpots([key], now);
  return map.get(key) ?? { spot: null, source: null };
}

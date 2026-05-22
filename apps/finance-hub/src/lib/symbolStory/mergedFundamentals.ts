import { fetchYahooChartResult } from "@/lib/market/yahooChartFetch";
import { fetchYahooTrailingDividendStats } from "@/lib/market/yahooChartDividends";

import { extractYahooLongNameFromChartResult } from "./symbolDisplayName";
import { fetchSchwabInstrumentFundamental } from "@/lib/schwab/instrumentFundamental";

import { fetchSchwabQuotesNormalized } from "@/lib/dividends/dividendModelQuotes";

export type MergedFundamentalsSnapshot = {
  displayName: string | null;
  divYield: number | null;
  annualDivEst: number | null;
  nextExDate: string | null;
  raw: Record<string, unknown>;
  /** e.g. schwab_fundamental, yahoo_chart_div, schwab_fundamental+yahoo_chart_div */
  source: string;
};

/**
 * Schwab fundamentals when available; Yahoo chart dividend history fills missing yield / annual / next ex.
 */
export async function fetchMergedDividendFundamentals(
  symbol: string,
  opts?: { skipYahoo?: boolean },
): Promise<MergedFundamentalsSnapshot> {
  const sym = symbol.trim().toUpperCase();
  const parts: string[] = [];

  let schwabDiv: number | null = null;
  let schwabRaw: Record<string, unknown> | null = null;
  let companyName: string | null = null;
  let sector: string | null = null;
  let industry: string | null = null;
  try {
    const f = await fetchSchwabInstrumentFundamental(sym);
    schwabDiv = f.divYield;
    schwabRaw = f.raw ?? null;
    companyName = f.companyName;
    sector = f.sector;
    industry = f.industry;
    if (schwabDiv != null && schwabDiv > 0) parts.push("schwab_fundamental");
  } catch {
    /* Schwab optional */
  }

  let px: number | null = null;
  try {
    const quotes = await fetchSchwabQuotesNormalized([sym]);
    const q = quotes.get(sym);
    px = q?.last ?? q?.mark ?? q?.close ?? null;
  } catch {
    /* quotes optional */
  }

  const annualFromSchwab =
    px != null && schwabDiv != null && Number.isFinite(px) && Number.isFinite(schwabDiv) && schwabDiv > 0
      ? px * schwabDiv
      : null;

  let yahoo: Awaited<ReturnType<typeof fetchYahooTrailingDividendStats>> = null;
  let yahooLongName: string | null = null;
  if (!opts?.skipYahoo) {
    try {
      yahoo = await fetchYahooTrailingDividendStats(sym);
      if (yahoo?.annualTrailing12m != null && yahoo.annualTrailing12m > 0) parts.push("yahoo_chart_div");
      yahooLongName = yahoo?.longName?.trim() || null;
    } catch {
      /* Yahoo optional */
    }
  } else if (!companyName?.trim()) {
    try {
      const chart = await fetchYahooChartResult(sym, "div");
      if (chart) {
        yahooLongName = extractYahooLongNameFromChartResult(chart.result);
        if (yahooLongName) parts.push("yahoo_chart_meta");
      }
    } catch {
      /* Yahoo optional */
    }
  }

  if (px == null && yahoo?.chartPrice != null && yahoo.chartPrice > 0) {
    px = yahoo.chartPrice;
  }

  let divYield: number | null = schwabDiv != null && schwabDiv > 0 ? schwabDiv : null;
  let annualDivEst: number | null = annualFromSchwab != null && annualFromSchwab > 0 ? annualFromSchwab : null;
  let nextExDate: string | null = null;

  if ((divYield == null || divYield <= 0 || annualDivEst == null || annualDivEst <= 0) && yahoo) {
    if (yahoo.annualTrailing12m != null && yahoo.annualTrailing12m > 0) {
      annualDivEst = yahoo.annualTrailing12m;
      if (px != null && px > 0) {
        divYield = annualDivEst / px;
      } else if (yahoo.divYield != null && yahoo.divYield > 0) {
        divYield = yahoo.divYield;
      }
    }
    if (yahoo.nextExDateIso) nextExDate = yahoo.nextExDateIso;
  }

  if ((divYield == null || divYield <= 0) && annualDivEst != null && annualDivEst > 0 && px != null && px > 0) {
    divYield = annualDivEst / px;
  }

  if (!nextExDate && yahoo?.nextExDateIso) {
    nextExDate = yahoo.nextExDateIso;
  }

  const source = parts.length ? Array.from(new Set(parts)).join("+") : "none";

  const trimmedSchwab = companyName?.trim();
  const resolvedCompany =
    trimmedSchwab && trimmedSchwab.length > 0
      ? trimmedSchwab
      : yahooLongName || yahoo?.longName?.trim() || null;

  return {
    displayName: resolvedCompany,
    divYield,
    annualDivEst,
    nextExDate,
    raw: {
      companyName: resolvedCompany,
      sector,
      industry,
      schwab: schwabRaw,
      yahoo: yahoo?.raw ?? null,
      yahooTrailing12m: yahoo?.annualTrailing12m ?? null,
      yahooChartPrice: yahoo?.chartPrice ?? null,
    },
    source,
  };
}

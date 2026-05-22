import { getDb } from "@/lib/db";
import { schwabQuoteDisplayPrice } from "@/lib/market/schwabQuoteDisplay";
import { normalizeSchwabQuoteSymbol } from "@/lib/market/schwabSymbol";
import { logError } from "@/lib/log";
import { schwabMarketFetch } from "@/lib/schwab/client";
import { schwabQuoteObjectFromEntry } from "@/lib/schwab/quoteEntry";
import { syncTaxonomyFromSchwab } from "@/lib/taxonomy";

import {
  fetchSchwabInstrumentFundamental,
  parseSchwabInstrumentFundamental,
  type SchwabCompanyPayload,
} from "./instrumentFundamental";

function normSym(s: string) {
  return normalizeSchwabQuoteSymbol(s);
}

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function pickPositive(...vals: Array<number | null | undefined>): number | null {
  for (const v of vals) {
    if (v != null && Number.isFinite(v) && v > 0) return v;
  }
  return null;
}

function normalizeDivYield(v: number | null): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  if (v > 1 && v <= 100) return v / 100;
  return v >= 0 ? v : null;
}

export type EnrichedCompanyProfile = SchwabCompanyPayload & {
  quoteLast: number | null;
  quoteVolume: number | null;
  sessionHigh: number | null;
  sessionLow: number | null;
};

function parseQuoteExtras(q: Record<string, unknown> | null): {
  last: number | null;
  week52High: number | null;
  week52Low: number | null;
  volume: number | null;
  sessionHigh: number | null;
  sessionLow: number | null;
} {
  if (!q) {
    return {
      last: null,
      week52High: null,
      week52Low: null,
      volume: null,
      sessionHigh: null,
      sessionLow: null,
    };
  }
  const rawLast = asNumber(q.lastPrice);
  const mark = asNumber(q.mark);
  const close = asNumber(q.closePrice);
  const last = schwabQuoteDisplayPrice(rawLast, mark, close);
  return {
    last,
    week52High: pickPositive(
      asNumber(q["52WeekHigh"]),
      asNumber(q.fiftyTwoWeekHigh),
      asNumber(q.week52High),
    ),
    week52Low: pickPositive(
      asNumber(q["52WeekLow"]),
      asNumber(q.fiftyTwoWeekLow),
      asNumber(q.week52Low),
    ),
    volume: pickPositive(asNumber(q.totalVolume), asNumber(q.volume)),
    sessionHigh: pickPositive(asNumber(q.highPrice), asNumber(q.high)),
    sessionLow: pickPositive(asNumber(q.lowPrice), asNumber(q.low)),
  };
}

async function fetchSchwabQuoteBundle(symbol: string): Promise<{
  quote: Record<string, unknown> | null;
  entry: unknown;
}> {
  const sym = normSym(symbol);
  try {
    const resp = await schwabMarketFetch<Record<string, unknown>>(
      `/quotes?symbols=${encodeURIComponent(sym)}`,
    );
    const entry = resp[sym] ?? resp[sym.toUpperCase()];
    return { entry, quote: schwabQuoteObjectFromEntry(entry) };
  } catch (e) {
    logError("company_profile_quote", e);
    return { entry: null, quote: null };
  }
}

function readTaxonomy(symbol: string): {
  sector: string | null;
  industry: string | null;
  marketCap: number | null;
} {
  const db = getDb();
  const row = db
    .prepare(`SELECT sector, industry, market_cap AS marketCap FROM security_taxonomy WHERE symbol = ?`)
    .get(symbol) as { sector: string | null; industry: string | null; marketCap: number | null } | undefined;
  const sector =
    row?.sector && row.sector.trim() && !/^n\/?a$/i.test(row.sector.trim()) ? row.sector.trim() : null;
  const industry =
    row?.industry && row.industry.trim() && !/^n\/?a$/i.test(row.industry.trim()) ? row.industry.trim() : null;
  const marketCap =
    row?.marketCap != null && Number.isFinite(row.marketCap) && row.marketCap > 0 ? row.marketCap : null;
  return { sector, industry, marketCap };
}

function emptyBase(symbol: string): SchwabCompanyPayload {
  return {
    symbol,
    companyName: null,
    sector: null,
    industry: null,
    marketCap: null,
    pe: null,
    divYield: null,
    beta: null,
    week52High: null,
    week52Low: null,
    avgVol: null,
    raw: {},
  };
}

function mergeProfiles(
  base: SchwabCompanyPayload,
  quote: ReturnType<typeof parseQuoteExtras>,
  tax: ReturnType<typeof readTaxonomy>,
  fundamental: Record<string, unknown>,
): EnrichedCompanyProfile {
  const shares = pickPositive(
    asNumber(fundamental.sharesOutstanding),
    asNumber(fundamental["sharesOutstanding"]),
  );
  const impliedCap =
    shares != null && quote.last != null && quote.last > 0 ? shares * quote.last : null;

  const divFromAmount =
    quote.last != null && quote.last > 0
      ? (() => {
          const amt = pickPositive(asNumber(fundamental.divAmount), asNumber(fundamental.dividendAmount));
          return amt != null ? amt / quote.last! : null;
        })()
      : null;

  return {
    ...base,
    sector: base.sector ?? tax.sector,
    industry: base.industry ?? tax.industry,
    marketCap: pickPositive(base.marketCap, tax.marketCap, impliedCap),
    pe: base.pe,
    divYield: base.divYield ?? normalizeDivYield(divFromAmount),
    beta: base.beta,
    week52High: pickPositive(base.week52High, quote.week52High),
    week52Low: pickPositive(base.week52Low, quote.week52Low),
    avgVol: pickPositive(base.avgVol, quote.volume),
    quoteLast: quote.last,
    quoteVolume: quote.volume,
    sessionHigh: quote.sessionHigh,
    sessionLow: quote.sessionLow,
  };
}

/**
 * Fresh company profile: Schwab instrument fundamentals + live quote + cached taxonomy (sync one symbol if cap missing).
 */
export async function fetchEnrichedCompanyProfile(symbol: string): Promise<EnrichedCompanyProfile> {
  const sym = normSym(symbol);

  const [fundamentalResult, quoteBundle] = await Promise.all([
    fetchSchwabInstrumentFundamental(sym).catch((e) => {
      logError("company_profile_fundamental", e);
      return null;
    }),
    fetchSchwabQuoteBundle(sym),
  ]);

  const quote = parseQuoteExtras(quoteBundle.quote);

  let base: SchwabCompanyPayload = fundamentalResult ?? emptyBase(sym);

  if (!fundamentalResult && quoteBundle.entry) {
    const reParsed = parseSchwabInstrumentFundamental({ [sym]: quoteBundle.entry }, sym);
    base = { symbol: sym, ...reParsed };
  }

  let tax = readTaxonomy(sym);
  if (tax.marketCap == null && !tax.sector) {
    await syncTaxonomyFromSchwab([sym]).catch(() => null);
    tax = readTaxonomy(sym);
  }

  return mergeProfiles(base, quote, tax, base.raw);
}

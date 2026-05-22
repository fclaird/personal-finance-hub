import { getDb } from "@/lib/db";
import { buildSymbolNarrative, type SymbolNarrativeResult } from "@/lib/symbolStory/symbolNarrative";
import {
  cachedNarrativeToApiPayload,
  isCachedNarrativeStale,
  readCachedSymbolNarrative,
  upsertCachedSymbolNarrative,
  type CachedSymbolNarrative,
} from "@/lib/symbolStory/symbolNarrativeCache";
import { latestNarrativeFilingDate } from "@/lib/sec/edgarSubmissions";

function normSym(symbol: string): string {
  return (symbol ?? "").trim().toUpperCase();
}

function narrativeFromCache(cached: CachedSymbolNarrative): SymbolNarrativeResult {
  return {
    symbol: cached.symbol,
    companyName: null,
    sector: null,
    industry: null,
    businessSummary: cached.businessSummary,
    paragraphs: [],
    sources: cached.sources,
    contentSource: cached.contentSource,
    yahooProfileUrl: cached.yahooProfileUrl,
    secFilingSummary: cached.secFilingSummary,
    secForm: cached.secForm,
    secFilingDate: cached.secFilingDate,
    secDocumentUrl: cached.secDocumentUrl,
    secCik: cached.secCik,
    secAccession: cached.secAccession,
  };
}

function cacheFromNarrative(n: SymbolNarrativeResult): Omit<CachedSymbolNarrative, "fetchedAt"> {
  return {
    symbol: n.symbol,
    businessSummary: n.businessSummary,
    sources: n.sources,
    contentSource: n.contentSource,
    yahooProfileUrl: n.yahooProfileUrl,
    secFilingSummary: n.secFilingSummary,
    secCik: n.secCik,
    secForm: n.secForm,
    secFilingDate: n.secFilingDate,
    secAccession: n.secAccession,
    secDocumentUrl: n.secDocumentUrl,
  };
}

export function readSymbolNarrativeCache(symbol: string): CachedSymbolNarrative | null {
  const sym = normSym(symbol);
  if (!sym) return null;
  return readCachedSymbolNarrative(getDb(), sym);
}

export async function checkSymbolNarrativeStale(symbol: string): Promise<boolean> {
  const sym = normSym(symbol);
  if (!sym) return true;
  const cached = readCachedSymbolNarrative(getDb(), sym);
  const latest = await latestNarrativeFilingDate(sym);
  return isCachedNarrativeStale(cached, latest);
}

/** Return cached narrative for immediate display (no network). */
export function getSymbolNarrativeCacheResponse(symbol: string) {
  const sym = normSym(symbol);
  if (!sym) return { ok: false as const, error: "Missing symbol" };
  const cached = readCachedSymbolNarrative(getDb(), sym);
  if (!cached) {
    return {
      ok: true as const,
      symbol: sym,
      businessSummary: "",
      sources: [] as string[],
      fromCache: true,
      stale: true,
      hasCache: false,
    };
  }
  return {
    ...cachedNarrativeToApiPayload(cached, { fromCache: true, stale: false }),
    hasCache: true,
  };
}

/**
 * Rebuild narrative when missing or stale; persists to SQLite.
 */
export async function revalidateSymbolNarrative(symbol: string): Promise<{
  ok: true;
  updated: boolean;
  stale: boolean;
  narrative: SymbolNarrativeResult;
}> {
  const sym = normSym(symbol);
  const db = getDb();
  const cached = readCachedSymbolNarrative(db, sym);
  const latest = await latestNarrativeFilingDate(sym);
  const stale = isCachedNarrativeStale(cached, latest);

  if (cached && !stale) {
    return { ok: true, updated: false, stale: false, narrative: narrativeFromCache(cached) };
  }

  const narrative = await buildSymbolNarrative(sym);
  upsertCachedSymbolNarrative(db, cacheFromNarrative(narrative));
  return { ok: true, updated: true, stale, narrative };
}

export function narrativeToApiPayload(
  narrative: SymbolNarrativeResult,
  opts?: { fromCache?: boolean; stale?: boolean; updated?: boolean },
) {
  return {
    ok: true as const,
    symbol: narrative.symbol,
    companyName: narrative.companyName,
    sector: narrative.sector,
    industry: narrative.industry,
    businessSummary: narrative.businessSummary,
    sources: narrative.sources,
    paragraphs: narrative.paragraphs,
    contentSource: narrative.contentSource,
    secFilingSummary: narrative.secFilingSummary,
    secForm: narrative.secForm,
    secFilingDate: narrative.secFilingDate,
    secDocumentUrl: narrative.secDocumentUrl,
    yahooProfileUrl: narrative.yahooProfileUrl,
    fetchedAt: new Date().toISOString(),
    fromCache: opts?.fromCache ?? false,
    stale: opts?.stale ?? false,
    updated: opts?.updated,
  };
}

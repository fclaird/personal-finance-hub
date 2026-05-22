import type Database from "better-sqlite3";

import type { NarrativeContentSource } from "@/lib/symbolStory/symbolNarrative";

export type { NarrativeContentSource };

export type CachedSymbolNarrative = {
  symbol: string;
  businessSummary: string;
  sources: string[];
  contentSource: NarrativeContentSource;
  yahooProfileUrl: string | null;
  secFilingSummary: string | null;
  secCik: string | null;
  secForm: string | null;
  secFilingDate: string | null;
  secAccession: string | null;
  secDocumentUrl: string | null;
  fetchedAt: string;
};

const STALE_AFTER_MS = 90 * 24 * 60 * 60 * 1000;

function normSym(symbol: string): string {
  return (symbol ?? "").trim().toUpperCase();
}

function parseContentSource(src: string): NarrativeContentSource {
  if (
    src === "override" ||
    src === "sec" ||
    src === "yahoo" ||
    src === "wikidata" ||
    src === "wiki" ||
    src === "fallback" ||
    src === "mixed"
  ) {
    return src;
  }
  if (src === "grokipedia") return "yahoo";
  return "fallback";
}

export function readCachedSymbolNarrative(db: Database.Database, symbol: string): CachedSymbolNarrative | null {
  const sym = normSym(symbol);
  if (!sym) return null;
  const row = db
    .prepare(
      `SELECT symbol, business_summary, sources_json, content_source,
              yahoo_profile_url, grokipedia_url, sec_filing_summary, sec_cik, sec_form, sec_filing_date, sec_accession, sec_document_url, fetched_at
       FROM symbol_issuer_narrative WHERE symbol = ? COLLATE NOCASE`,
    )
    .get(sym) as
    | {
        symbol: string;
        business_summary: string;
        sources_json: string;
        content_source: string;
        yahoo_profile_url: string | null;
        grokipedia_url: string | null;
        sec_filing_summary: string | null;
        sec_cik: string | null;
        sec_form: string | null;
        sec_filing_date: string | null;
        sec_accession: string | null;
        sec_document_url: string | null;
        fetched_at: string;
      }
    | undefined;
  if (!row) return null;
  let sources: string[] = [];
  try {
    const parsed = JSON.parse(row.sources_json) as unknown;
    if (Array.isArray(parsed)) sources = parsed.filter((s): s is string => typeof s === "string");
  } catch {
    sources = [];
  }
  return {
    symbol: row.symbol,
    businessSummary: row.business_summary,
    sources,
    contentSource: parseContentSource(row.content_source),
    yahooProfileUrl: row.yahoo_profile_url ?? row.grokipedia_url,
    secFilingSummary: row.sec_filing_summary ?? null,
    secCik: row.sec_cik,
    secForm: row.sec_form,
    secFilingDate: row.sec_filing_date,
    secAccession: row.sec_accession,
    secDocumentUrl: row.sec_document_url,
    fetchedAt: row.fetched_at,
  };
}

export function upsertCachedSymbolNarrative(
  db: Database.Database,
  row: Omit<CachedSymbolNarrative, "fetchedAt"> & { fetchedAt?: string },
): CachedSymbolNarrative {
  const sym = normSym(row.symbol);
  const now = row.fetchedAt ?? new Date().toISOString();
  db.prepare(
    `INSERT INTO symbol_issuer_narrative (
       symbol, business_summary, sources_json, content_source,
       yahoo_profile_url, sec_filing_summary, sec_cik, sec_form, sec_filing_date, sec_accession, sec_document_url,
       fetched_at, updated_at
     ) VALUES (
       @symbol, @business_summary, @sources_json, @content_source,
       @yahoo_profile_url, @sec_filing_summary, @sec_cik, @sec_form, @sec_filing_date, @sec_accession, @sec_document_url,
       @fetched_at, @updated_at
     )
     ON CONFLICT(symbol) DO UPDATE SET
       business_summary = excluded.business_summary,
       sources_json = excluded.sources_json,
       content_source = excluded.content_source,
       yahoo_profile_url = excluded.yahoo_profile_url,
       sec_filing_summary = excluded.sec_filing_summary,
       sec_cik = excluded.sec_cik,
       sec_form = excluded.sec_form,
       sec_filing_date = excluded.sec_filing_date,
       sec_accession = excluded.sec_accession,
       sec_document_url = excluded.sec_document_url,
       fetched_at = excluded.fetched_at,
       updated_at = excluded.updated_at`,
  ).run({
    symbol: sym,
    business_summary: row.businessSummary,
    sources_json: JSON.stringify(row.sources),
    content_source: row.contentSource,
    yahoo_profile_url: row.yahooProfileUrl,
    sec_filing_summary: row.secFilingSummary,
    sec_cik: row.secCik,
    sec_form: row.secForm,
    sec_filing_date: row.secFilingDate,
    sec_accession: row.secAccession,
    sec_document_url: row.secDocumentUrl,
    fetched_at: now,
    updated_at: now,
  });
  return { ...row, symbol: sym, fetchedAt: now };
}

/** True when a newer SEC filing exists or cache is very old. */
export function isCachedNarrativeStale(
  cached: CachedSymbolNarrative | null,
  latestSecFilingDate: string | null,
): boolean {
  if (!cached) return true;
  if (cached.contentSource === "override") return false;
  if (cached.contentSource === "sec") return true;
  if (
    cached.contentSource === "fallback" &&
    /is classified in the .+ sector/i.test(cached.businessSummary)
  ) {
    return true;
  }
  if (cached.contentSource === "wikidata" && cached.businessSummary.length < 100) return true;
  if (/\bcommune in the\b/i.test(cached.businessSummary)) return true;
  if (/\bdepartment in (northern )?france\b/i.test(cached.businessSummary) && /\bbelgian border\b/i.test(cached.businessSummary)) {
    return true;
  }
  if (/\bgivet is a commune\b/i.test(cached.businessSummary)) return true;
  if (cached.contentSource === "wiki" && /\bis a \d{4}\b.*\b(film|movie)\b/i.test(cached.businessSummary)) {
    return true;
  }
  if (
    cached.sources.some((s) => /\bPr\s+In\b.*\bEtf\b/i.test(s)) &&
    (cached.contentSource === "wiki" || /\bcommune in the\b/i.test(cached.businessSummary))
  ) {
    return true;
  }
  if (/equity award|participating subsidiary|exercise price/i.test(cached.secFilingSummary ?? "")) {
    return true;
  }
  if (/not available from/i.test(cached.businessSummary)) return true;
  if (/^thus,\s+an investment in units/i.test(cached.businessSummary)) return true;
  if (!cached.secFilingSummary && cached.secDocumentUrl) return true;
  if (latestSecFilingDate && cached.secFilingDate) {
    return latestSecFilingDate > cached.secFilingDate;
  }
  if (latestSecFilingDate && !cached.secFilingDate) return true;
  const age = Date.now() - Date.parse(cached.fetchedAt);
  if (!Number.isFinite(age)) return true;
  return age > STALE_AFTER_MS;
}

export function cachedNarrativeToApiPayload(cached: CachedSymbolNarrative, opts?: { fromCache?: boolean; stale?: boolean }) {
  return {
    ok: true as const,
    symbol: cached.symbol,
    businessSummary: cached.businessSummary,
    sources: cached.sources,
    contentSource: cached.contentSource,
    secFilingSummary: cached.secFilingSummary,
    secForm: cached.secForm,
    secFilingDate: cached.secFilingDate,
    secDocumentUrl: cached.secDocumentUrl,
    yahooProfileUrl: cached.yahooProfileUrl,
    hasCache: true,
    fetchedAt: cached.fetchedAt,
    fromCache: opts?.fromCache ?? true,
    stale: opts?.stale ?? false,
  };
}

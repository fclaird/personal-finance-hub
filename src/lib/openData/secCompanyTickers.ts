import { logError } from "@/lib/log";
import { normTicker, prettifyIssuerName } from "@/lib/openData/issuerDisplayName";
import { secFetchText } from "@/lib/sec/secFetch";

const SEC_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

type SecRow = { cik_str?: number; ticker?: string; title?: string };

export type SecCompanyEntry = { cik: number; title: string };

let cache: { loadedAt: number; map: Map<string, SecCompanyEntry> } | null = null;

function tickerVariants(sym: string): string[] {
  const u = normTicker(sym);
  const dash = u.replace(/\./g, "-");
  const dot = u.replace(/-/g, ".");
  return [...new Set([u, dash, dot].filter(Boolean))];
}

async function loadSecTickerMap(): Promise<Map<string, SecCompanyEntry>> {
  const text = await secFetchText(SEC_TICKERS_URL);
  if (!text) throw new Error("SEC company_tickers: empty or blocked response");
  const json = JSON.parse(text) as Record<string, SecRow> | SecRow[];
  const map = new Map<string, SecCompanyEntry>();

  const ingest = (ticker: string | undefined, title: string | undefined, cik: number | undefined) => {
    if (!ticker || !title || cik == null || !Number.isFinite(cik)) return;
    map.set(normTicker(ticker), { cik: Math.trunc(cik), title: title.trim() });
  };

  if (Array.isArray(json)) {
    for (const row of json) ingest(row?.ticker, row?.title, row?.cik_str);
  } else {
    for (const k of Object.keys(json)) {
      const row = json[k];
      if (row && typeof row === "object") ingest(row.ticker, row.title, row.cik_str);
    }
  }

  return map;
}

async function getSecEntryMap(): Promise<Map<string, SecCompanyEntry> | null> {
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) return cache.map;
  try {
    const map = await loadSecTickerMap();
    cache = { loadedAt: Date.now(), map };
    return map;
  } catch (e) {
    logError("sec_company_tickers_fetch", e);
    return null;
  }
}

/**
 * Cached SEC registrant ticker → company title (official filing names, often ALL CAPS).
 * Returns null if download fails (rate limit, offline, etc.).
 */
export async function getSecCompanyTickerMap(): Promise<Map<string, string> | null> {
  const entries = await getSecEntryMap();
  if (!entries) return null;
  const titles = new Map<string, string>();
  for (const [k, v] of entries) titles.set(k, prettifyIssuerName(v.title));
  return titles;
}

export async function lookupSecCompanyEntry(symbol: string): Promise<SecCompanyEntry | null> {
  const map = await getSecEntryMap();
  if (!map) return null;
  for (const key of tickerVariants(symbol)) {
    const row = map.get(key);
    if (row) return { cik: row.cik, title: prettifyIssuerName(row.title) };
  }
  return null;
}

export async function lookupSecCompanyCik(symbol: string): Promise<number | null> {
  const row = await lookupSecCompanyEntry(symbol);
  return row?.cik ?? null;
}

export function lookupSecCompanyTitle(map: Map<string, string> | null, symbol: string): string | null {
  if (!map) return null;
  for (const key of tickerVariants(symbol)) {
    const raw = map.get(key);
    if (raw) return raw;
  }
  return null;
}

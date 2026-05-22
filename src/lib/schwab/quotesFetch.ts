import { schwabMarketFetch } from "@/lib/schwab/client";

export type SchwabQuotesResponse = Record<string, unknown>;

const QUOTE_TTL_MS = 15_000;
const BATCH_SIZE = 50;

type CacheRow = { at: number; entry: unknown };

const quoteCache = new Map<string, CacheRow>();
const inflightByKey = new Map<string, Promise<SchwabQuotesResponse>>();

function normSym(s: string) {
  return (s ?? "").trim().toUpperCase();
}

async function fetchMissingQuoteBatches(missing: string[], now: number): Promise<SchwabQuotesResponse> {
  const fetched: SchwabQuotesResponse = {};
  for (let i = 0; i < missing.length; i += BATCH_SIZE) {
    const batch = missing.slice(i, i + BATCH_SIZE);
    const resp = await schwabMarketFetch<SchwabQuotesResponse>(
      `/quotes?symbols=${encodeURIComponent(batch.join(","))}`,
    );
    for (const sym of batch) {
      const entry = resp[sym] ?? resp[sym.toUpperCase()];
      if (entry !== undefined) {
        quoteCache.set(sym, { at: now, entry });
        fetched[sym] = entry;
      }
    }
  }
  return fetched;
}

/**
 * Fetch Schwab /quotes with a short-lived per-symbol cache and in-flight deduplication.
 */
export async function fetchSchwabQuotesResponse(symbols: string[]): Promise<SchwabQuotesResponse> {
  const uniq = [...new Set(symbols.map(normSym).filter(Boolean))];
  if (uniq.length === 0) return {};

  const now = Date.now();
  const merged: SchwabQuotesResponse = {};
  const missing: string[] = [];

  for (const sym of uniq) {
    const hit = quoteCache.get(sym);
    if (hit && now - hit.at < QUOTE_TTL_MS) {
      merged[sym] = hit.entry;
    } else {
      missing.push(sym);
    }
  }

  if (missing.length === 0) return merged;

  const inflightKey = missing.slice().sort().join(",");
  let inflight = inflightByKey.get(inflightKey);
  if (!inflight) {
    inflight = fetchMissingQuoteBatches(missing, now).finally(() => {
      inflightByKey.delete(inflightKey);
    });
    inflightByKey.set(inflightKey, inflight);
  }

  const fetched = await inflight;
  for (const [sym, entry] of Object.entries(fetched)) {
    merged[sym] = entry;
  }
  return merged;
}

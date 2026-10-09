import { getDb } from "@/lib/db";
import { isUsEquityRegularSessionOpen, nyYmd } from "@/lib/market/usEquitySession";
import { schwabMarketFetch } from "@/lib/schwab/client";
import {
  cacheIsFresh,
  makeOptionChain,
  type ChainDraft,
  type OptionChain,
} from "@/lib/optionChain/chain";
import { parseCboeChain } from "@/lib/optionChain/internal/cboeWire";
import { parseSchwabChain } from "@/lib/optionChain/internal/schwabWire";

const NORMALIZER_VERSION = 1;

export type ChainResult =
  | { readonly ok: true; readonly chain: OptionChain }
  | { readonly ok: false; readonly error: string; readonly hint?: string };

const inflight = new Map<string, Promise<ChainResult>>();

function symbolOk(symbol: string): string | null {
  const s = symbol.trim().toUpperCase();
  return /^[A-Z][A-Z0-9.]{0,9}$/.test(s) ? s : null;
}

type CacheRow = { payload_json: string; fetched_at: string; normalizer_version: number };

function readCache(symbol: string): CacheRow | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT payload_json, fetched_at, normalizer_version FROM option_chain_cache WHERE symbol = ?`,
    )
    .get(symbol) as CacheRow | undefined;
  return row ?? null;
}

function writeCache(chain: OptionChain): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO option_chain_cache (symbol, source, normalizer_version, quote_time, fetched_at, payload_json)
     VALUES (@symbol, @source, @version, @quoteTime, @fetchedAt, @payload)
     ON CONFLICT(symbol) DO UPDATE SET
       source = excluded.source,
       normalizer_version = excluded.normalizer_version,
       quote_time = excluded.quote_time,
       fetched_at = excluded.fetched_at,
       payload_json = excluded.payload_json`,
  ).run({
    symbol: chain.symbol,
    source: chain.provenance.source,
    version: NORMALIZER_VERSION,
    quoteTime: chain.provenance.quoteTime,
    fetchedAt: chain.provenance.fetchedAt,
    payload: JSON.stringify(chain),
  });
}

function chainFromCache(row: CacheRow, servedFrom: "cache" | "staleCache"): OptionChain | null {
  if (row.normalizer_version !== NORMALIZER_VERSION) return null;
  try {
    const chain = JSON.parse(row.payload_json) as OptionChain;
    if (!chain || chain.multiplier !== 100 || !Array.isArray(chain.expiries)) return null;
    return { ...chain, provenance: { ...chain.provenance, servedFrom } };
  } catch {
    return null;
  }
}

async function fetchSchwab(symbol: string, fetchedAt: string): Promise<ChainDraft | null> {
  const qs = new URLSearchParams({
    symbol,
    contractType: "ALL",
    strategy: "SINGLE",
    range: "ALL",
    includeUnderlyingQuote: "true",
  });
  const body = await schwabMarketFetch<unknown>(`/chains?${qs.toString()}`);
  return parseSchwabChain(symbol, body, fetchedAt);
}

async function fetchCboe(symbol: string, fetchedAt: string): Promise<ChainDraft | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const resp = await fetch(`https://cdn.cboe.com/api/global/delayed_quotes/options/${encodeURIComponent(symbol)}.json`, {
      signal: ctrl.signal,
      headers: { Accept: "application/json", "User-Agent": "financial-bridge/strategy-lab" },
      redirect: "follow",
    });
    if (!resp.ok) return null;
    const body: unknown = await resp.json();
    return parseCboeChain(symbol, body, fetchedAt);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function load(symbol: string, refresh: boolean): Promise<ChainResult> {
  const now = new Date();
  const cached = readCache(symbol);
  if (cached && cacheIsFresh(Date.parse(cached.fetched_at), now.getTime(), isUsEquityRegularSessionOpen(now), refresh)) {
    const chain = chainFromCache(cached, "cache");
    if (chain) return { ok: true, chain };
  }

  const fetchedAt = now.toISOString();
  let fallbackFrom: string | null = null;
  let draft: ChainDraft | null = null;
  try {
    draft = await fetchSchwab(symbol, fetchedAt);
  } catch (e) {
    fallbackFrom = e instanceof Error ? e.message : "Schwab chain failed.";
  }
  if (!draft) {
    if (!fallbackFrom) fallbackFrom = "Schwab returned no chain.";
    draft = await fetchCboe(symbol, fetchedAt);
    if (draft) draft = { ...draft, fallbackFrom };
  }

  if (draft) {
    if (!draft.tradeDate) draft = { ...draft, tradeDate: nyYmd(now) };
    const built = makeOptionChain(draft);
    if (built.ok) {
      writeCache(built.chain);
      return built;
    }
    fallbackFrom = built.error;
  }

  if (cached) {
    const stale = chainFromCache(cached, "staleCache");
    if (stale) return { ok: true, chain: stale };
  }
  return {
    ok: false,
    error: fallbackFrom ?? "No option chain.",
    hint: "Connect Schwab for a live chain, or retry. Cboe delayed quotes are the fallback.",
  };
}

/** Full chain for one underlying. Schwab, then Cboe delayed, then a stale cache row. */
export function getOptionChain(symbol: string, opts?: { refresh?: boolean }): Promise<ChainResult> {
  const sym = symbolOk(symbol);
  if (!sym) return Promise.resolve({ ok: false, error: "Enter a ticker symbol." });
  const refresh = opts?.refresh === true;
  const key = `${sym}:${refresh ? "1" : "0"}`;
  const existing = inflight.get(key);
  if (existing) return existing;
  const pending = load(sym, refresh).finally(() => {
    if (inflight.get(key) === pending) inflight.delete(key);
  });
  inflight.set(key, pending);
  return pending;
}

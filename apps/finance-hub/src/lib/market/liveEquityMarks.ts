import { schwabQuoteDisplayPrice } from "@/lib/market/schwabQuoteDisplay";
import { normalizeSchwabQuoteSymbol } from "@/lib/market/schwabSymbol";
import { schwabQuoteObjectFromEntry } from "@/lib/schwab/quoteEntry";
import { fetchSchwabQuotesResponse } from "@/lib/schwab/quotesFetch";

export type { QuoteLike } from "@/lib/market/equityMarkPrice";
export {
  liveEquityMarkPx,
  resolveEquityMarkPx,
  underPxMapFromNormalizedQuotes,
} from "@/lib/market/equityMarkPrice";

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/** Same display price as `/api/quotes` `last` (mark-aware when last is stale). */
export function displayPriceFromSchwabQuoteEntry(entry: unknown): number | null {
  const q = schwabQuoteObjectFromEntry(entry);
  if (!q) return null;
  const rawLast = asNumber(q.lastPrice) ?? null;
  const mark = asNumber(q.mark) ?? null;
  const close = asNumber(q.closePrice) ?? null;
  return schwabQuoteDisplayPrice(rawLast, mark, close);
}

/** Batch-fetch Schwab live marks for equity underlyings (cached in quotesFetch). */
export async function buildLiveEquityMarkMap(symbols: Iterable<string>): Promise<Map<string, number>> {
  const uniq = [...new Set([...symbols].map((s) => normalizeSchwabQuoteSymbol(s)).filter(Boolean))];
  if (uniq.length === 0) return new Map();
  try {
    const resp = await fetchSchwabQuotesResponse(uniq);
    const out = new Map<string, number>();
    for (const sym of uniq) {
      const entry = resp[sym] ?? resp[sym.toUpperCase()];
      const px = displayPriceFromSchwabQuoteEntry(entry);
      if (px != null) out.set(sym, px);
    }
    return out;
  } catch {
    return new Map();
  }
}

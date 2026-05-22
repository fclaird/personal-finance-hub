import { normalizeSchwabQuoteSymbol } from "@/lib/market/schwabSymbol";
import { schwabQuoteDisplayPrice } from "@/lib/market/schwabQuoteDisplay";
import { fetchSchwabQuotesResponse } from "@/lib/schwab/quotesFetch";
import { schwabQuoteObjectFromEntry } from "@/lib/schwab/quoteEntry";

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

export type DividendModelQuote = {
  symbol: string;
  last: number | null;
  mark: number | null;
  close: number | null;
};

export async function fetchSchwabQuotesNormalized(symbols: string[]): Promise<Map<string, DividendModelQuote>> {
  const uniq = Array.from(new Set(symbols.map((s) => normalizeSchwabQuoteSymbol(s)).filter(Boolean)));
  const out = new Map<string, DividendModelQuote>();
  const resp = await fetchSchwabQuotesResponse(uniq);
  for (const sym of uniq) {
    const entry = resp[sym] ?? resp[sym.toUpperCase()];
    const q = schwabQuoteObjectFromEntry(entry);
    if (!q) {
      out.set(sym, { symbol: sym, last: null, mark: null, close: null });
      continue;
    }
    const rawLast = asNumber(q.lastPrice) ?? null;
    const mark = asNumber(q.mark) ?? null;
    const close = asNumber(q.closePrice) ?? null;
    const last = schwabQuoteDisplayPrice(rawLast, mark, close);
    out.set(sym, { symbol: sym, last, mark, close });
  }
  return out;
}

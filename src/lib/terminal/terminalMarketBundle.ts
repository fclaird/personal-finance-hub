import type { NormalizedQuote } from "@/app/api/quotes/route";
import { schwabQuoteDisplayPrice } from "@/lib/market/schwabQuoteDisplay";
import { schwabCompanyNameFromQuoteEntry } from "@/lib/schwab/quoteCompanyName";
import { fetchSchwabQuotesResponse } from "@/lib/schwab/quotesFetch";
import { schwabQuoteObjectFromEntry } from "@/lib/schwab/quoteEntry";

export type TerminalHeatmapItem = {
  symbol: string;
  changePercent: number | null;
  marketCap: number | null;
  companyName: string | null;
};

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

function normSym(s: string) {
  return (s ?? "").trim().toUpperCase();
}

export async function buildTerminalMarketBundle(
  symbols: string[],
  capMap: Map<string, number | null>,
): Promise<{ quotes: NormalizedQuote[]; heatItems: TerminalHeatmapItem[] }> {
  const uniq = [...new Set(symbols.map(normSym).filter(Boolean))];
  const nowIso = new Date().toISOString();
  const resp = await fetchSchwabQuotesResponse(uniq);

  const quotes: NormalizedQuote[] = [];
  const heatItems: TerminalHeatmapItem[] = [];

  for (const sym of uniq) {
    const entry = resp[sym] ?? resp[sym.toUpperCase()];
    const companyName = schwabCompanyNameFromQuoteEntry(entry);
    const q = schwabQuoteObjectFromEntry(entry);

    if (!q) {
      quotes.push({
        symbol: sym,
        last: null,
        bid: null,
        ask: null,
        mark: null,
        close: null,
        open: null,
        high: null,
        low: null,
        volume: null,
        change: null,
        changePercent: null,
        week52High: null,
        week52Low: null,
        companyName,
        updatedAt: nowIso,
      });
      heatItems.push({ symbol: sym, changePercent: null, marketCap: capMap.get(sym) ?? null, companyName });
      continue;
    }

    const rawLast = asNumber(q.lastPrice) ?? null;
    const bid = asNumber(q.bidPrice ?? q.bid) ?? null;
    const ask = asNumber(q.askPrice ?? q.ask) ?? null;
    const mark = asNumber(q.mark) ?? null;
    const close = asNumber(q.closePrice) ?? null;
    const last = schwabQuoteDisplayPrice(rawLast, mark, close);
    const change =
      asNumber(q.netChange ?? q.change) ?? (last != null && close != null ? last - close : null);
    const changePercent =
      asNumber(q.netPercentChangeInDouble ?? q.changePercent) ??
      (change != null && close != null && close !== 0 ? change / close : null);

    quotes.push({
      symbol: sym,
      last,
      bid,
      ask,
      mark,
      close,
      open: pickPositive(asNumber(q.openPrice)),
      high: pickPositive(asNumber(q.highPrice), asNumber(q.high)),
      low: pickPositive(asNumber(q.lowPrice), asNumber(q.low)),
      volume: pickPositive(asNumber(q.totalVolume), asNumber(q.volume)),
      change,
      changePercent: changePercent == null ? null : changePercent,
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
      companyName,
      updatedAt: nowIso,
    });

    heatItems.push({
      symbol: sym,
      changePercent: changePercent == null ? null : changePercent,
      marketCap: capMap.get(sym) ?? null,
      companyName,
    });
  }

  return { quotes, heatItems };
}

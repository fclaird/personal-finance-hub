import { NextResponse } from "next/server";

import { logError } from "@/lib/log";
import { schwabQuoteDisplayPrice } from "@/lib/market/schwabQuoteDisplay";
import { normalizeSchwabQuoteSymbol } from "@/lib/market/schwabSymbol";
import { schwabCompanyNameFromQuoteEntry } from "@/lib/schwab/quoteCompanyName";
import { fetchSchwabQuotesResponse } from "@/lib/schwab/quotesFetch";
import { schwabQuoteObjectFromEntry } from "@/lib/schwab/quoteEntry";

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
  return normalizeSchwabQuoteSymbol(s);
}

export type NormalizedQuote = {
  symbol: string;
  last: number | null;
  bid: number | null;
  ask: number | null;
  mark: number | null;
  close: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  change: number | null;
  changePercent: number | null;
  week52High: number | null;
  week52Low: number | null;
  companyName?: string | null;
  updatedAt: string;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as { symbols?: string[] } | null;
    const symbols = Array.from(new Set((body?.symbols ?? []).map(normSym).filter(Boolean)));
    if (symbols.length === 0) return NextResponse.json({ ok: true, quotes: [], n: 0 });

    const out: NormalizedQuote[] = [];
    const nowIso = new Date().toISOString();
    const resp = await fetchSchwabQuotesResponse(symbols);

    for (const sym of symbols) {
        const entry = resp[sym] ?? resp[sym.toUpperCase()];
        const companyName = schwabCompanyNameFromQuoteEntry(entry);
        const q = schwabQuoteObjectFromEntry(entry);
        if (!q) {
          out.push({
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
          continue;
        }

        const rawLast = asNumber(q.lastPrice) ?? null;
        const bid = asNumber(q.bidPrice ?? q.bid) ?? null;
        const ask = asNumber(q.askPrice ?? q.ask) ?? null;
        const mark = asNumber(q.mark) ?? null;
        const close = asNumber(q.closePrice) ?? null;
        const open = pickPositive(asNumber(q.openPrice));
        const high = pickPositive(asNumber(q.highPrice), asNumber(q.high));
        const low = pickPositive(asNumber(q.lowPrice), asNumber(q.low));
        const week52High = pickPositive(
          asNumber(q["52WeekHigh"]),
          asNumber(q.fiftyTwoWeekHigh),
          asNumber(q.week52High),
        );
        const week52Low = pickPositive(
          asNumber(q["52WeekLow"]),
          asNumber(q.fiftyTwoWeekLow),
          asNumber(q.week52Low),
        );
        const volume = pickPositive(asNumber(q.totalVolume), asNumber(q.volume));
        const last = schwabQuoteDisplayPrice(rawLast, mark, close);
        const change =
          asNumber(q.netChange ?? q.change) ?? (last != null && close != null ? last - close : null);
        const changePercent =
          asNumber(q.netPercentChangeInDouble ?? q.changePercent) ??
          (change != null && close != null && close !== 0 ? change / close : null);

        out.push({
          symbol: sym,
          last,
          bid,
          ask,
          mark,
          close,
          open,
          high,
          low,
          volume,
          change,
          changePercent: changePercent == null ? null : changePercent,
          week52High,
          week52Low,
          companyName,
          updatedAt: nowIso,
        });
    }

    return NextResponse.json(
      { ok: true, quotes: out, n: out.length },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logError("api_quotes_post", e);
    return NextResponse.json({ ok: false, error: msg, quotes: [], n: 0 }, { status: 502 });
  }
}


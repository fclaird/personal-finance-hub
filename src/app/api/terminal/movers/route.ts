import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { logError } from "@/lib/log";
import { parseSchwabNormalizedQuote } from "@/lib/market/parseSchwabNormalizedQuote";
import { fetchSchwabQuotesResponse } from "@/lib/schwab/quotesFetch";
import { schwabQuoteObjectFromEntry } from "@/lib/schwab/quoteEntry";
import { BASKETS, type TerminalBasketKey } from "@/lib/terminal/baskets";
import { computeMovers } from "@/lib/terminal/movers";
import { SP500_SYMBOLS } from "@/lib/terminal/universes/sp500";
import { DATA_MODE_COOKIE, parseDataMode } from "@/lib/dataMode";
import { getTerminalUniverseSymbols } from "@/lib/terminal/universe";

function normSym(s: string) {
  return (s ?? "").trim().toUpperCase();
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const scope = (url.searchParams.get("scope") ?? "basket").trim() as "basket" | "sp500" | "myUniverse" | "combined";
  const basketKey = (url.searchParams.get("basket") ?? "big50").trim() as TerminalBasketKey;
  const top = Math.max(1, Math.min(100, Number(url.searchParams.get("top") ?? "50") || 50));
  const watchlistId = url.searchParams.get("watchlistId");

  const key = scope === "basket" ? basketKey : scope;
  const emptyMoversPayload = (): ReturnType<typeof computeMovers> => ({
    basketKey: key,
    asOf: new Date().toISOString(),
    gainers: [],
    losers: [],
  });

  try {
    let symbols: string[] = [];
    if (scope === "sp500") {
      symbols = SP500_SYMBOLS.map(normSym).filter(Boolean);
    } else if (scope === "myUniverse" || scope === "combined") {
      const jar = await cookies();
      const mode = parseDataMode(jar.get(DATA_MODE_COOKIE)?.value);
      const mine = getTerminalUniverseSymbols({ mode, includeWatchlistId: watchlistId });
      if (scope === "combined") {
        symbols = Array.from(new Set([...SP500_SYMBOLS.map(normSym), ...mine.map(normSym)].filter(Boolean)));
      } else {
        symbols = mine;
      }
    } else {
      symbols = (BASKETS[basketKey] ?? []).map(normSym).filter(Boolean);
    }

    if (symbols.length === 0)
      return NextResponse.json({ ok: false, error: "No symbols for scope", ...emptyMoversPayload() }, { status: 400 });

    const quotes: import("@/app/api/quotes/route").NormalizedQuote[] = [];
    const nowIso = new Date().toISOString();
    const resp = await fetchSchwabQuotesResponse(symbols);
    for (const sym of symbols) {
      const entry = resp[sym] ?? resp[sym.toUpperCase()];
      const q = schwabQuoteObjectFromEntry(entry);
      quotes.push(parseSchwabNormalizedQuote(sym, q, nowIso));
    }

    const movers = computeMovers(key, quotes, top);
    return NextResponse.json({ ok: true, scope, top, symbols: symbols.length, watchlistId, ...movers });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logError("terminal_movers_get", e);
    return NextResponse.json(
      {
        ok: false,
        error: msg,
        scope,
        top,
        symbols: 0,
        watchlistId,
        ...emptyMoversPayload(),
      },
      { status: 502 },
    );
  }
}


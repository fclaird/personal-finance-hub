import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { logError } from "@/lib/log";
import { DATA_MODE_COOKIE, parseDataMode } from "@/lib/dataMode";
import { getDb } from "@/lib/db";
import { BASKETS } from "@/lib/terminal/baskets";
import { buildTerminalMarketBundle } from "@/lib/terminal/terminalMarketBundle";
import { getTerminalUniverseSymbols } from "@/lib/terminal/universe";
import { SP500_SYMBOLS } from "@/lib/terminal/universes/sp500";
import { syncTaxonomyFromSchwab } from "@/lib/taxonomy";

function normSym(s: string) {
  return (s ?? "").trim().toUpperCase();
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const view = (url.searchParams.get("view") ?? "portfolio").trim() as "spy" | "qqq" | "portfolio";
  const watchlistId = url.searchParams.get("watchlistId");

  try {
    const jar = await cookies();
    const mode = parseDataMode(jar.get(DATA_MODE_COOKIE)?.value);

    let symbols: string[] = [];
    if (view === "spy") symbols = SP500_SYMBOLS.map(normSym).filter(Boolean);
    else if (view === "qqq") symbols = (BASKETS.big50 ?? []).map(normSym).filter(Boolean);
    else symbols = getTerminalUniverseSymbols({ mode, includeWatchlistId: watchlistId });

    const db = getDb();
    const caps =
      symbols.length === 0
        ? ([] as Array<{ symbol: string; market_cap: number | null }>)
        : (db
            .prepare(
              `
              SELECT symbol, market_cap
              FROM security_taxonomy
              WHERE symbol IN (${symbols.map(() => "?").join(",")})
              `,
            )
            .all(...symbols) as Array<{ symbol: string; market_cap: number | null }>);
    const capMap = new Map<string, number | null>();
    for (const r of caps) capMap.set(normSym(r.symbol), r.market_cap);

    const warm = symbols.filter((s) => capMap.get(s) == null).slice(0, 40);
    if (warm.length > 0) {
      void syncTaxonomyFromSchwab(warm).catch(() => null);
    }

    const { heatItems: items } = await buildTerminalMarketBundle(symbols, capMap);

    return NextResponse.json({ ok: true, view, watchlistId, n: items.length, items });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logError("terminal_heatmap_get", e);
    return NextResponse.json(
      { ok: false, error: msg, view, watchlistId, n: 0, items: [] },
      { status: 502 },
    );
  }
}

import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { DATA_MODE_COOKIE, parseDataMode } from "@/lib/dataMode";
import { logError } from "@/lib/log";
import { getTerminalUniverseSymbols } from "@/lib/terminal/universe";
import { QQQ_SYMBOLS } from "@/lib/terminal/universes/qqq";
import { SP500_SYMBOLS } from "@/lib/terminal/universes/sp500";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const watchlistId = url.searchParams.get("watchlistId");
    const scope = (url.searchParams.get("scope") ?? "portfolio").toLowerCase();
    const jar = await cookies();
    const mode = parseDataMode(jar.get(DATA_MODE_COOKIE)?.value);
    const symbols =
      scope === "spy"
        ? SP500_SYMBOLS
        : scope === "qqq"
          ? QQQ_SYMBOLS
          : getTerminalUniverseSymbols({ mode, includeWatchlistId: watchlistId });
    return NextResponse.json({ ok: true, mode, scope, watchlistId, symbols, n: symbols.length });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logError("terminal_universe_get", e);
    return NextResponse.json(
      { ok: false, error: msg, mode: null, scope: null, watchlistId: null, symbols: [], n: 0 },
      { status: 500 },
    );
  }
}


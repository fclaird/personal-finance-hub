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

function resolveHeatmapSymbols(
  view: "spy" | "qqq" | "portfolio",
  mode: ReturnType<typeof parseDataMode>,
  watchlistId: string | null,
): string[] {
  if (view === "spy") return SP500_SYMBOLS.map(normSym).filter(Boolean);
  if (view === "qqq") return (BASKETS.big50 ?? []).map(normSym).filter(Boolean);
  return getTerminalUniverseSymbols({ mode, includeWatchlistId: watchlistId });
}

type BootstrapPayload = {
  ok: true;
  view: "spy" | "qqq" | "portfolio";
  watchlistId: string | null;
  quotes: Awaited<ReturnType<typeof buildTerminalMarketBundle>>["quotes"];
  heatItems: Awaited<ReturnType<typeof buildTerminalMarketBundle>>["heatItems"];
};

let inflightBootstrap: Promise<BootstrapPayload> | null = null;
let inflightBootstrapKey = "";
let bootstrapResultCache: { key: string; at: number; payload: BootstrapPayload } | null = null;
const BOOTSTRAP_RESULT_TTL_MS = 8_000;

async function buildBootstrapPayload(
  view: "spy" | "qqq" | "portfolio",
  watchlistId: string | null,
  indices: string[],
): Promise<BootstrapPayload> {
  const jar = await cookies();
  const mode = parseDataMode(jar.get(DATA_MODE_COOKIE)?.value);
  const heatSymbols = resolveHeatmapSymbols(view, mode, watchlistId);
  const symbols = [...new Set([...heatSymbols, ...indices])];

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

  const { quotes, heatItems } = await buildTerminalMarketBundle(symbols, capMap);
  return { ok: true, view, watchlistId, quotes, heatItems };
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as {
      view?: string;
      watchlistId?: string | null;
      indexSymbols?: string[];
    } | null;

    const view = (body?.view ?? "portfolio").trim() as "spy" | "qqq" | "portfolio";
    const watchlistId = body?.watchlistId ?? null;
    const indices = (body?.indexSymbols ?? ["SPY", "QQQ"]).map(normSym).filter(Boolean);
    const key = `${view}:${watchlistId ?? ""}`;
    const now = Date.now();
    if (
      bootstrapResultCache &&
      bootstrapResultCache.key === key &&
      now - bootstrapResultCache.at < BOOTSTRAP_RESULT_TTL_MS
    ) {
      return NextResponse.json(bootstrapResultCache.payload);
    }

    if (!inflightBootstrap || inflightBootstrapKey !== key) {
      inflightBootstrapKey = key;
      inflightBootstrap = buildBootstrapPayload(view, watchlistId, indices)
        .then((payload) => {
          bootstrapResultCache = { key, at: Date.now(), payload };
          return payload;
        })
        .finally(() => {
          inflightBootstrap = null;
        });
    }

    const payload = await inflightBootstrap;
    return NextResponse.json(payload);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logError("terminal_bootstrap_post", e);
    return NextResponse.json({ ok: false, error: msg, quotes: [], heatItems: [] }, { status: 502 });
  }
}

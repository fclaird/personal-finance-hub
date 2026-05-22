import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { schwabMarketFetch } from "@/lib/schwab/client";
import { DATA_MODE_COOKIE, parseDataMode } from "@/lib/dataMode";
import { getTerminalUniverseSymbols } from "@/lib/terminal/universe";

export type OptionFlowItem = {
  symbol: string;
  totalOptionVolume: number;
};

function normSym(s: string) {
  return (s ?? "").trim().toUpperCase();
}

/** Sum contract volumes from Schwab `/chains` payload (callExpDateMap / putExpDateMap). */
function sumOptionChainVolume(chain: unknown): number {
  if (!chain || typeof chain !== "object") return 0;
  const root = chain as Record<string, unknown>;
  let sum = 0;
  for (const mapName of ["callExpDateMap", "putExpDateMap"] as const) {
    const dateMap = root[mapName];
    if (!dateMap || typeof dateMap !== "object") continue;
    for (const strikeMap of Object.values(dateMap as Record<string, unknown>)) {
      if (!strikeMap || typeof strikeMap !== "object") continue;
      for (const contracts of Object.values(strikeMap as Record<string, unknown>)) {
        if (!Array.isArray(contracts)) continue;
        for (const c of contracts) {
          if (!c || typeof c !== "object") continue;
          const o = c as Record<string, unknown>;
          const v =
            typeof o.totalVolume === "number" && Number.isFinite(o.totalVolume)
              ? o.totalVolume
              : typeof o.volume === "number" && Number.isFinite(o.volume)
                ? o.volume
                : null;
          if (v != null) sum += v;
        }
      }
    }
  }
  return sum;
}

const CHAIN_CONCURRENCY = 4;
const MAX_SYMBOLS = 48;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const watchlistId = url.searchParams.get("watchlistId");

  const jar = await cookies();
  const mode = parseDataMode(jar.get(DATA_MODE_COOKIE)?.value);

  const symbols = getTerminalUniverseSymbols({ mode, includeWatchlistId: watchlistId })
    .map(normSym)
    .filter(Boolean)
    .slice(0, MAX_SYMBOLS);

  if (symbols.length === 0) {
    return NextResponse.json({
      ok: true,
      source: "unavailable" as const,
      hint: "No symbols in the terminal universe yet.",
      items: [] as OptionFlowItem[],
    });
  }

  try {
    const volumes = new Map<string, number>();

    async function fetchChain(sym: string) {
      const qs = new URLSearchParams({
        symbol: sym,
        contractType: "ALL",
        strikeCount: "12",
      });
      const data = await schwabMarketFetch<unknown>(`/chains?${qs.toString()}`);
      const vol = sumOptionChainVolume(data);
      volumes.set(sym, vol);
    }

    for (let i = 0; i < symbols.length; i += CHAIN_CONCURRENCY) {
      const batch = symbols.slice(i, i + CHAIN_CONCURRENCY);
      await Promise.all(batch.map((s) => fetchChain(s).catch(() => null)));
    }

    const items: OptionFlowItem[] = Array.from(volumes.entries())
      .map(([symbol, totalOptionVolume]) => ({ symbol, totalOptionVolume }))
      .filter((x) => x.totalOptionVolume > 0)
      .sort((a, b) => b.totalOptionVolume - a.totalOptionVolume)
      .slice(0, 10);

    return NextResponse.json({
      ok: true,
      source: "schwab" as const,
      items,
      scanned: symbols.length,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({
      ok: true,
      source: "unavailable" as const,
      hint:
        msg.includes("not connected") || msg.includes("401")
          ? "Connect Schwab under Connections to load option chain volume."
          : "Option chain data is unavailable right now.",
      detail: msg,
      items: [] as OptionFlowItem[],
    });
  }
}

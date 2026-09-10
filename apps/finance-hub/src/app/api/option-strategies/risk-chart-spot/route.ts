import { NextResponse } from "next/server";

import { logError } from "@/lib/log";
import { fetchRiskChartSpots } from "@/lib/options/fetchRiskChartSpot";
import { normalizeSchwabQuoteSymbol } from "@/lib/market/schwabSymbol";

function parseSymbols(url: URL): string[] {
  const raw = [url.searchParams.get("symbols"), url.searchParams.get("symbol")]
    .filter((v): v is string => !!v)
    .join(",");
  return [...new Set(raw.split(",").map((s) => normalizeSchwabQuoteSymbol(s)).filter(Boolean))];
}

/** Live equity spot(s) for the Option Strategies PnL risk graphic only. Any underlying. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const symbols = parseSymbols(url);
  if (symbols.length === 0) {
    return NextResponse.json({ ok: false, error: "Missing symbol", spot: null, spots: {} }, { status: 400 });
  }

  try {
    const map = await fetchRiskChartSpots(symbols);
    const spots: Record<string, number | null> = {};
    const sources: Record<string, string | null> = {};
    for (const sym of symbols) {
      const got = map.get(sym);
      spots[sym] = got?.spot ?? null;
      sources[sym] = got?.source ?? null;
    }
    const first = symbols[0]!;
    return NextResponse.json(
      { ok: true, symbol: first, spot: spots[first] ?? null, source: sources[first] ?? null, spots, sources },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch (e) {
    logError("risk_chart_spot_get", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e), spot: null, spots: {} },
      { status: 502 },
    );
  }
}

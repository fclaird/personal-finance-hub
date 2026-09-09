import { NextResponse } from "next/server";

import { logError } from "@/lib/log";
import { fetchRiskChartSpot } from "@/lib/options/fetchRiskChartSpot";
import { normalizeSchwabQuoteSymbol } from "@/lib/market/schwabSymbol";

/** Live equity spot for the Option Strategies PnL risk graphic only. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const symbol = normalizeSchwabQuoteSymbol(url.searchParams.get("symbol") ?? "");
  if (!symbol) {
    return NextResponse.json({ ok: false, error: "Missing symbol", spot: null }, { status: 400 });
  }

  try {
    const got = await fetchRiskChartSpot(symbol);
    return NextResponse.json(
      { ok: true, symbol, spot: got.spot, source: got.source },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch (e) {
    logError("risk_chart_spot_get", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e), spot: null },
      { status: 502 },
    );
  }
}

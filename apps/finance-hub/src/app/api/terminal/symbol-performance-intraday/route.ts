import { NextResponse } from "next/server";

import { normalizeSchwabQuoteSymbol } from "@/lib/market/schwabSymbol";
import { fetchSymbolPerformanceIntraday } from "@/lib/terminal/symbolPerformanceIntraday";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const symbols = (url.searchParams.get("symbols") ?? "")
      .split(",")
      .map((s) => normalizeSchwabQuoteSymbol(s))
      .filter(Boolean);
    if (symbols.length === 0) {
      return NextResponse.json({ ok: false, error: "Missing symbols" }, { status: 400 });
    }

    const payload = await fetchSymbolPerformanceIntraday(symbols);
    return NextResponse.json({ ok: true, ...payload });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e), points: [] },
      { status: 500 },
    );
  }
}

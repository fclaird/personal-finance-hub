import { NextResponse } from "next/server";

import { loadChartCandles } from "@/lib/charts/loadCandles";
import { isChartInterval } from "@/lib/charts/types";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function chartSymbol(raw: string): string | null {
  const symbol = raw.trim().toUpperCase().replace(/\./g, "-");
  if (!/^[A-Z][A-Z0-9-]{0,14}$/.test(symbol)) return null;
  return symbol;
}

/** Daily and intraday OHLCV from Yahoo, cached in SQLite. Read only. */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const symbol = chartSymbol(url.searchParams.get("symbol") ?? "");
    const intervalRaw = (url.searchParams.get("interval") ?? "1d").trim();
    if (!symbol) return NextResponse.json({ ok: false, error: "Missing symbol" }, { status: 400 });
    if (!isChartInterval(intervalRaw)) {
      return NextResponse.json({ ok: false, error: "Invalid interval" }, { status: 400 });
    }
    const loaded = await loadChartCandles(getDb(), symbol, intervalRaw);
    return NextResponse.json({ ok: true, ...loaded });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}

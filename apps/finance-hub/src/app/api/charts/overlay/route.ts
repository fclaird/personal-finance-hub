import { NextResponse } from "next/server";

import { loadBookOverlay } from "@/lib/charts/bookOverlay";
import { getDb } from "@/lib/db";
import { resolveViewScope } from "@/lib/viewScope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function chartSymbol(raw: string): string | null {
  const symbol = raw.trim().toUpperCase().replace(/\./g, "-");
  if (!/^[A-Z][A-Z0-9-]{0,14}$/.test(symbol)) return null;
  return symbol;
}

/** Open option strikes and expiries for one underlying. Read only. */
export async function GET(req: Request) {
  const symbol = chartSymbol(new URL(req.url).searchParams.get("symbol") ?? "");
  if (!symbol) return NextResponse.json({ ok: false, error: "Missing symbol" }, { status: 400 });
  try {
    const scope = await resolveViewScope();
    const overlay = loadBookOverlay(getDb(), symbol, scope.flavor, scope.dataMode);
    return NextResponse.json({ ok: true, ...overlay });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message, strikes: [], expiries: [] }, { status: 500 });
  }
}

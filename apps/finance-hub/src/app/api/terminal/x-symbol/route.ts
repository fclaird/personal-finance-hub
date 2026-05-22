import { NextResponse } from "next/server";

import { readSymbolCache } from "@/lib/x/cacheDb";

function normSym(s: string) {
  return (s ?? "").trim().toUpperCase();
}

/** Cache read only — no X API calls. Use POST /api/terminal/x-symbol/refresh to populate. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const symbol = normSym(url.searchParams.get("symbol") ?? "");
  if (!symbol) {
    return NextResponse.json({ ok: false, error: "symbol required" }, { status: 400 });
  }

  const cached = readSymbolCache(symbol);
  if (!cached) {
    return NextResponse.json({
      ok: true,
      hasData: false,
      symbol,
      summary: "",
      posts: [],
      generatedAt: null as string | null,
    });
  }

  return NextResponse.json({ ok: true, hasData: true, cached: true, ...cached });
}

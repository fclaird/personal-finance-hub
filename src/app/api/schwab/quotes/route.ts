import { NextResponse } from "next/server";

import { runSchwabQuotesPersist } from "@/lib/schwab/schwabQuotesPersist";

export async function POST() {
  const result = await runSchwabQuotesPersist();
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error ?? "Quotes persist failed" }, { status: 500 });
  }
  return NextResponse.json({
    ok: true,
    updated: result.updated,
    symbols: result.symbols,
    date: result.date,
  });
}

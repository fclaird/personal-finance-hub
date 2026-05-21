import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { ensurePresetDividendPortfolios } from "@/lib/dividendModels/seed";
import { syncScaledHoldingsFromAlpha } from "@/lib/dividendModels/syncScaledShares";

export async function POST() {
  const db = getDb();
  try {
    ensurePresetDividendPortfolios(db);
    const result = syncScaledHoldingsFromAlpha(db);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

import { NextResponse } from "next/server";

import { fetchUsMarketIndexCards, ensureUsMarketIndexBenchmarks } from "@/lib/market/usMarketIndices";
import { usEquitySessionStatus } from "@/lib/market/usEquitySession";

export async function GET() {
  try {
    await ensureUsMarketIndexBenchmarks();
    const items = await fetchUsMarketIndexCards();
    const session = usEquitySessionStatus(new Date());
    return NextResponse.json({
      ok: true,
      session,
      items,
      updatedAt: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e), items: [] },
      { status: 500 },
    );
  }
}

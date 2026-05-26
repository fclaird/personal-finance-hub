import { NextResponse } from "next/server";

import { fetchRegionalMarketItems } from "@/lib/market/regionalMarkets";
import { japanEquitySessionStatus, koreaEquitySessionStatus } from "@/lib/market/asiaEquitySession";
import { usEquitySessionStatus } from "@/lib/market/usEquitySession";

export async function GET() {
  try {
    const now = new Date();
    const [items, usSession, jpSession, krSession] = await Promise.all([
      fetchRegionalMarketItems(now),
      Promise.resolve(usEquitySessionStatus(now)),
      Promise.resolve(japanEquitySessionStatus(now)),
      Promise.resolve(koreaEquitySessionStatus(now)),
    ]);
    return NextResponse.json({
      ok: true,
      updatedAt: now.toISOString(),
      regions: {
        us: usSession,
        jp: jpSession,
        kr: krSession,
      },
      items,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e), items: [] },
      { status: 500 },
    );
  }
}

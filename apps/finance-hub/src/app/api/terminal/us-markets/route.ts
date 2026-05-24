import { NextResponse } from "next/server";

import { fetchUsMarketIndexCards, ensureUsMarketIndexBenchmarks } from "@/lib/market/usMarketIndices";
import { formatGlanceSessionLabel, glanceSessionYmd, glanceSessionUsesPriorDay } from "@/lib/market/glanceSession";
import { usEquitySessionStatus } from "@/lib/market/usEquitySession";
import { fetchPortfolioGlanceCard } from "@/lib/terminal/portfolioGlance";

export async function GET() {
  try {
    const now = new Date();
    await ensureUsMarketIndexBenchmarks();
    const sessionYmd = glanceSessionYmd(now);
    const [portfolio, indexItems] = await Promise.all([
      fetchPortfolioGlanceCard(now),
      fetchUsMarketIndexCards(now),
    ]);
    const session = usEquitySessionStatus(now);
    const sessionLabel = formatGlanceSessionLabel(sessionYmd);
    return NextResponse.json({
      ok: true,
      session: {
        ...session,
        sessionYmd,
        sessionLabel,
        showingPriorSession: glanceSessionUsesPriorDay(now),
      },
      items: [portfolio, ...indexItems],
      updatedAt: now.toISOString(),
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e), items: [] },
      { status: 500 },
    );
  }
}

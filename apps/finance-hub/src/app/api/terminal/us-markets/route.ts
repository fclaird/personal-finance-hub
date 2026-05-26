import { NextResponse } from "next/server";

import { fetchGlanceAlternateCards } from "@/lib/market/fetchGlanceAlternateCards";
import { fetchRegionalGlanceItems } from "@/lib/market/regionalGlanceItems";
import { fetchUsMarketIndexCards, ensureUsMarketIndexBenchmarks } from "@/lib/market/usMarketIndices";
import { formatGlanceSessionLabel, glanceSessionYmd, glanceSessionUsesPriorDay } from "@/lib/market/glanceSession";
import { fetchCanonicalGlanceGrid } from "@/lib/market/glanceSessionGrid";
import { usEquitySessionStatus } from "@/lib/market/usEquitySession";
import { fetchPortfolioGlanceCard } from "@/lib/terminal/portfolioGlance";

export async function GET() {
  try {
    const now = new Date();
    await ensureUsMarketIndexBenchmarks();
    const sessionYmd = glanceSessionYmd(now);
    const grid = await fetchCanonicalGlanceGrid(sessionYmd, now);
    const [portfolio, indexItems, futuresGlanceItems, alternateGlanceItems] = await Promise.all([
      fetchPortfolioGlanceCard(now, grid),
      fetchUsMarketIndexCards(now, grid),
      fetchRegionalGlanceItems(now),
      fetchGlanceAlternateCards(now, grid),
    ]);
    const russell2000 = alternateGlanceItems.find((item) => item.id === "russell2000") ?? null;
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
      alternateGlanceItems,
      futuresGlanceItems: russell2000 ? [...futuresGlanceItems, russell2000] : futuresGlanceItems,
      updatedAt: now.toISOString(),
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e), items: [] },
      { status: 500 },
    );
  }
}

import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { buildPortfolioDashboard } from "@/lib/dividendModels/dashboardMetrics";
import { inferHoldingCategory } from "@/lib/dividendModels/holdingCategory";
import { loadEnrichedHoldings } from "@/lib/dividendModels/enrichedHoldings";
import { fetchSimulatedDividendsForPortfolio } from "@/lib/dividendModels/simulatedDividends";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id: portfolioId } = await ctx.params;
  const db = getDb();
  const exists = db.prepare(`SELECT 1 FROM dividend_model_portfolios WHERE id = ?`).get(portfolioId);
  if (!exists) return NextResponse.json({ ok: false, error: "Portfolio not found" }, { status: 404 });

  const rows = await loadEnrichedHoldings(db, portfolioId);
  const dividends = fetchSimulatedDividendsForPortfolio(db, portfolioId);
  const dashboard = buildPortfolioDashboard(
    rows.map((r) => ({
      symbol: r.symbol,
      shares: r.shares,
      last: r.last,
      marketValue: r.marketValue,
      sector: r.sector,
      industry: r.industry,
      avgUnitCost: r.avgUnitCost,
    })),
    dividends,
    inferHoldingCategory,
  );

  return NextResponse.json({ ok: true, dashboard });
}

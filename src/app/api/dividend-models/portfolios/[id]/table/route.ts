import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { computeFooterTotals, loadEnrichedHoldings } from "@/lib/dividendModels/enrichedHoldings";
import { readBacktestAnchorClose } from "@/lib/dividendModels/symbolBacktestAnchor";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { id: portfolioId } = await ctx.params;
  const url = new URL(req.url);
  const forceRefetch =
    url.searchParams.get("refetchFundamentals") === "1" || url.searchParams.get("refetchFundamentals") === "true";
  const db = getDb();
  const exists = db.prepare(`SELECT 1 FROM dividend_model_portfolios WHERE id = ?`).get(portfolioId);
  if (!exists) return NextResponse.json({ ok: false, error: "Portfolio not found" }, { status: 404 });

  const enriched = await loadEnrichedHoldings(db, portfolioId, { forceRefetchFundamentals: forceRefetch });
  const rows = enriched.map((r) => ({
    holdingId: r.holdingId,
    symbol: r.symbol,
    displayName: r.displayName,
    shares: r.shares,
    sortOrder: r.sortOrder,
    last: r.last,
    divYield: r.divYield,
    annualDivEst: r.annualDivEst,
    marketValue: r.marketValue,
    nextExDate: r.nextExDate,
    sector: r.sector,
    industry: r.industry,
    avgUnitCost: r.avgUnitCost,
    category: r.category,
    cost: r.cost,
    backtestStartPrice5y: readBacktestAnchorClose(db, r.symbol, 5),
  }));

  const footer = computeFooterTotals(enriched);

  return NextResponse.json({ ok: true, rows, footer });
}

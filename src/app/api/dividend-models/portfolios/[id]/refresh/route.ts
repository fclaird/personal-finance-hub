import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { refreshDividendModelPortfolio } from "@/lib/dividendModels/refresh";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  const { id: portfolioId } = await ctx.params;
  const db = getDb();
  const exists = db.prepare(`SELECT 1 FROM dividend_model_portfolios WHERE id = ?`).get(portfolioId);
  if (!exists) return NextResponse.json({ ok: false, error: "Portfolio not found" }, { status: 404 });

  try {
    const result = await refreshDividendModelPortfolio(portfolioId, db);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

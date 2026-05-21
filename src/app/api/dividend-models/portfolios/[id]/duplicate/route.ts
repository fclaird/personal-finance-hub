import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { newId } from "@/lib/id";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  const { id: sourceId } = await ctx.params;
  const db = getDb();
  const src = db.prepare(`SELECT name FROM dividend_model_portfolios WHERE id = ?`).get(sourceId) as { name: string } | undefined;
  if (!src) return NextResponse.json({ ok: false, error: "Portfolio not found" }, { status: 404 });

  const newIdVal = newId("dmport");
  const newName = `${src.name} copy`;
  const holdings = db
    .prepare(`SELECT symbol, sort_order, shares FROM dividend_model_holdings WHERE portfolio_id = ? ORDER BY sort_order ASC`)
    .all(sourceId) as Array<{ symbol: string; sort_order: number; shares: number | null }>;

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO dividend_model_portfolios (id, name, live_started_at, tracking_mode, meta_json) VALUES (?, ?, NULL, 'backtest', NULL)`,
    ).run(
      newIdVal,
      newName,
    );
    const ins = db.prepare(
      `INSERT INTO dividend_model_holdings (id, portfolio_id, symbol, sort_order, shares) VALUES (?, ?, ?, ?, ?)`,
    );
    for (const h of holdings) {
      ins.run(newId("dmh"), newIdVal, h.symbol, h.sort_order, h.shares);
    }
  });
  tx();

  return NextResponse.json({ ok: true, id: newIdVal, name: newName });
}

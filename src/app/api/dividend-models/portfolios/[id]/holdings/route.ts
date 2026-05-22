import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { newId } from "@/lib/id";

type Ctx = { params: Promise<{ id: string }> };

function normSym(s: string) {
  return (s ?? "").trim().toUpperCase();
}

export async function GET(_req: Request, ctx: Ctx) {
  const { id: portfolioId } = await ctx.params;
  const db = getDb();
  const exists = db.prepare(`SELECT 1 FROM dividend_model_portfolios WHERE id = ?`).get(portfolioId);
  if (!exists) return NextResponse.json({ ok: false, error: "Portfolio not found" }, { status: 404 });

  const rows = db
    .prepare(
      `
      SELECT id, symbol, shares, sort_order AS sortOrder, avg_unit_cost AS avgUnitCost, created_at AS createdAt
      FROM dividend_model_holdings
      WHERE portfolio_id = ?
      ORDER BY sort_order ASC, symbol ASC
    `,
    )
    .all(portfolioId) as Array<{ id: string; symbol: string; shares: number | null; sortOrder: number; createdAt: string }>;
  return NextResponse.json({ ok: true, holdings: rows });
}

export async function POST(req: Request, ctx: Ctx) {
  const { id: portfolioId } = await ctx.params;
  const body = (await req.json().catch(() => null)) as {
    symbol?: string;
    shares?: number | null;
    avg_unit_cost?: number | null;
  } | null;
  const symbol = normSym(body?.symbol ?? "");
  if (!symbol) return NextResponse.json({ ok: false, error: "Missing symbol" }, { status: 400 });

  const db = getDb();
  const exists = db.prepare(`SELECT 1 FROM dividend_model_portfolios WHERE id = ?`).get(portfolioId);
  if (!exists) return NextResponse.json({ ok: false, error: "Portfolio not found" }, { status: 404 });

  const dup = db.prepare(`SELECT 1 FROM dividend_model_holdings WHERE portfolio_id = ? AND symbol = ?`).get(portfolioId, symbol);
  if (dup) return NextResponse.json({ ok: false, error: "Symbol already in portfolio" }, { status: 409 });

  const maxRow = db
    .prepare(`SELECT COALESCE(MAX(sort_order), -1) AS m FROM dividend_model_holdings WHERE portfolio_id = ?`)
    .get(portfolioId) as { m: number };
  const sortOrder = (maxRow?.m ?? -1) + 1;
  const shares = body?.shares != null && Number.isFinite(body.shares) ? body.shares : null;
  const hid = newId("dmh");
  db.prepare(
    `INSERT INTO dividend_model_holdings (id, portfolio_id, symbol, sort_order, shares, avg_unit_cost) VALUES (?, ?, ?, ?, ?, NULL)`,
  ).run(hid, portfolioId, symbol, sortOrder, shares);
  return NextResponse.json({ ok: true, id: hid, symbol, sortOrder, shares });
}

export async function PATCH(req: Request, ctx: Ctx) {
  const { id: portfolioId } = await ctx.params;
  const body = (await req.json().catch(() => null)) as {
    symbol?: string;
    shares?: number | null;
    sort_order?: number;
    avg_unit_cost?: number | null;
  } | null;
  const symbol = normSym(body?.symbol ?? "");
  if (!symbol) return NextResponse.json({ ok: false, error: "Missing symbol" }, { status: 400 });

  const db = getDb();
  const row = db
    .prepare(`SELECT id FROM dividend_model_holdings WHERE portfolio_id = ? AND symbol = ?`)
    .get(portfolioId, symbol) as { id: string } | undefined;
  if (!row) return NextResponse.json({ ok: false, error: "Holding not found" }, { status: 404 });

  const hasSort = body?.sort_order != null && Number.isFinite(body.sort_order);
  const hasShares = body?.shares !== undefined;
  const hasAvg = body?.avg_unit_cost !== undefined;

  if (hasSort && hasShares && hasAvg) {
    db.prepare(`UPDATE dividend_model_holdings SET sort_order = ?, shares = ?, avg_unit_cost = ? WHERE id = ?`).run(
      body.sort_order,
      body.shares,
      body.avg_unit_cost,
      row.id,
    );
  } else if (hasSort && hasShares) {
    db.prepare(`UPDATE dividend_model_holdings SET sort_order = ?, shares = ? WHERE id = ?`).run(body.sort_order, body.shares, row.id);
  } else if (hasSort && hasAvg) {
    db.prepare(`UPDATE dividend_model_holdings SET sort_order = ?, avg_unit_cost = ? WHERE id = ?`).run(
      body.sort_order,
      body.avg_unit_cost,
      row.id,
    );
  } else if (hasSort) {
    db.prepare(`UPDATE dividend_model_holdings SET sort_order = ? WHERE id = ?`).run(body.sort_order, row.id);
  } else if (hasShares && hasAvg) {
    db.prepare(`UPDATE dividend_model_holdings SET shares = ?, avg_unit_cost = ? WHERE id = ?`).run(
      body.shares,
      body.avg_unit_cost,
      row.id,
    );
  } else if (hasShares) {
    db.prepare(`UPDATE dividend_model_holdings SET shares = ? WHERE id = ?`).run(body.shares, row.id);
  } else if (hasAvg) {
    db.prepare(`UPDATE dividend_model_holdings SET avg_unit_cost = ? WHERE id = ?`).run(body.avg_unit_cost, row.id);
  } else {
    return NextResponse.json({ ok: false, error: "Nothing to update" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request, ctx: Ctx) {
  const { id: portfolioId } = await ctx.params;
  const url = new URL(req.url);
  const symbol = normSym(url.searchParams.get("symbol") ?? "");
  if (!symbol) return NextResponse.json({ ok: false, error: "Missing symbol query param" }, { status: 400 });

  const db = getDb();
  const r = db.prepare(`DELETE FROM dividend_model_holdings WHERE portfolio_id = ? AND symbol = ?`).run(portfolioId, symbol);
  if (r.changes === 0) return NextResponse.json({ ok: false, error: "Holding not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

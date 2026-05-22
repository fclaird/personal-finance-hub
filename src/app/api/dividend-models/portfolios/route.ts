import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { newId } from "@/lib/id";
import { ensurePresetDividendPortfolios } from "@/lib/dividendModels/seed";
import { parsePortfolioMeta } from "@/lib/dividendModels/portfolioMeta";

export async function GET() {
  const db = getDb();
  ensurePresetDividendPortfolios(db);
  const rows = db
    .prepare(
      `
      SELECT
        p.id AS id,
        p.name AS name,
        p.created_at AS createdAt,
        p.live_started_at AS liveStartedAt,
        p.tracking_mode AS trackingMode,
        p.meta_json AS metaJson,
        (SELECT COUNT(*) FROM dividend_model_holdings h WHERE h.portfolio_id = p.id) AS holdingCount
      FROM dividend_model_portfolios p
      ORDER BY p.created_at ASC, p.name ASC
    `,
    )
    .all() as Array<{
    id: string;
    name: string;
    createdAt: string;
    liveStartedAt: string | null;
    trackingMode: string | null;
    metaJson: string | null;
    holdingCount: number;
  }>;
  return NextResponse.json({
    ok: true,
    portfolios: rows.map((r) => {
      const meta = parsePortfolioMeta(r.metaJson);
      return {
        id: r.id,
        name: r.name,
        createdAt: r.createdAt,
        liveStartedAt: r.liveStartedAt,
        trackingMode: r.trackingMode === "live" ? "live" : "backtest",
        holdingCount: r.holdingCount,
        sliceAccountId: meta.sliceAccountId ?? null,
      };
    }),
  });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { name?: string } | null;
  const name = (body?.name ?? "").trim();
  if (!name) return NextResponse.json({ ok: false, error: "Missing portfolio name" }, { status: 400 });

  const db = getDb();
  const id = newId("dmport");
  db.prepare(
    `INSERT INTO dividend_model_portfolios (id, name, live_started_at, tracking_mode, meta_json) VALUES (?, ?, NULL, 'backtest', NULL)`,
  ).run(id, name);
  return NextResponse.json({ ok: true, id, name });
}

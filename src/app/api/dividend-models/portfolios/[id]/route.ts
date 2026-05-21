import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { captureForwardSnapForPortfolio, defaultLiveStartedAtIso } from "@/lib/dividendModels/forwardSnap";
import { parsePortfolioMeta, stringifyPortfolioMeta, type DividendPortfolioMeta } from "@/lib/dividendModels/portfolioMeta";
import { parseTrackingMode, type TrackingMode } from "@/lib/dividendModels/types";
import { notPosterityWhereSql } from "@/lib/posterity";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as
    | {
        name?: string;
        sliceAccountId?: string | null;
        trackingMode?: string;
        liveStartedAt?: string | null;
      }
    | null;

  const db = getDb();
  const row = db
    .prepare(`SELECT name, meta_json, live_started_at AS liveStartedAt, tracking_mode AS trackingMode FROM dividend_model_portfolios WHERE id = ?`)
    .get(id) as
    | { name: string; meta_json: string | null; liveStartedAt: string | null; trackingMode: string | null }
    | undefined;
  if (!row) return NextResponse.json({ ok: false, error: "Portfolio not found" }, { status: 404 });

  const meta = parsePortfolioMeta(row.meta_json);
  let nextName = row.name;
  let nextMeta: DividendPortfolioMeta = { ...meta };

  if (body?.name != null) {
    const name = String(body.name).trim();
    if (!name) return NextResponse.json({ ok: false, error: "Name cannot be empty" }, { status: 400 });
    nextName = name;
  }

  if (body && "sliceAccountId" in body) {
    const sid = body.sliceAccountId;
    if (sid === null || sid === "") {
      nextMeta.sliceAccountId = null;
    } else if (typeof sid === "string") {
      const trimmed = sid.trim();
      if (!trimmed.startsWith("schwab_")) {
        return NextResponse.json({ ok: false, error: "sliceAccountId must be a Schwab account id" }, { status: 400 });
      }
      const ok = db
        .prepare(
          `
          SELECT 1 AS x FROM accounts a
          WHERE a.id = ?
            AND a.id LIKE 'schwab_%'
            AND ${notPosterityWhereSql("a")}
          LIMIT 1
        `,
        )
        .get(trimmed) as { x: number } | undefined;
      if (!ok) return NextResponse.json({ ok: false, error: "Unknown or ineligible Schwab account" }, { status: 400 });
      nextMeta.sliceAccountId = trimmed;
    }
  }

  let nextTracking: TrackingMode =
    row.trackingMode === "live" ? "live" : "backtest";
  if (body?.trackingMode != null) {
    nextTracking = parseTrackingMode(body.trackingMode);
  }

  let nextLiveStarted = row.liveStartedAt;
  if (body && "liveStartedAt" in body) {
    nextLiveStarted = body.liveStartedAt?.trim() ? body.liveStartedAt.trim() : null;
  }
  if (nextTracking === "live" && !nextLiveStarted) {
    nextLiveStarted = defaultLiveStartedAtIso();
  }

  const metaStr = stringifyPortfolioMeta(nextMeta);
  db.prepare(
    `UPDATE dividend_model_portfolios SET name = ?, meta_json = ?, tracking_mode = ?, live_started_at = ? WHERE id = ?`,
  ).run(nextName, metaStr, nextTracking, nextLiveStarted, id);

  if (nextTracking === "live") {
    try {
      await captureForwardSnapForPortfolio(db, id);
    } catch {
      /* non-fatal: timeline load will retry capture */
    }
  }

  return NextResponse.json({
    ok: true,
    id,
    name: nextName,
    sliceAccountId: nextMeta.sliceAccountId ?? null,
    trackingMode: nextTracking,
    liveStartedAt: nextLiveStarted,
  });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const db = getDb();
  const r = db.prepare(`DELETE FROM dividend_model_portfolios WHERE id = ?`).run(id);
  if (r.changes === 0) return NextResponse.json({ ok: false, error: "Portfolio not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

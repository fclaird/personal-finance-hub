import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { SCREENER_NAME } from "@/lib/screener/name";
import { presetFilters } from "@/lib/screener/presets";
import { refreshScreener } from "@/lib/screener/refresh";
import { screenerCsv } from "@/lib/screener/csv";
import { addUserTicker, deletePreset, savePreset, saveWarEdit } from "@/lib/screener/store";
import { WAR_RATINGS, type CorrWindow, type ScreenerFilters, type WarRating } from "@/lib/screener/types";
import { loadScreenerPage } from "@/lib/screener/view";

export const runtime = "nodejs";

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function GET(req: Request) {
  try {
    const db = getDb();
    const page = loadScreenerPage(db);
    const url = new URL(req.url);
    if (url.searchParams.get("format") === "csv") {
      const window = (url.searchParams.get("window") ?? "1y") as CorrWindow;
      const active = window === "3m" || window === "1y" || window === "3y" ? window : "1y";
      return new Response(screenerCsv(page.rows, active), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${SCREENER_NAME.toLowerCase()}.csv"`,
        },
      });
    }
    return NextResponse.json({ ok: true, ...page });
  } catch (error) {
    return NextResponse.json({ ok: false, error: message(error) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { op?: string; ticker?: string; tickers?: string[]; rating?: string; sourceUrl?: string; unverified?: boolean; name?: string; filters?: ScreenerFilters; id?: string };
    const db = getDb();
    const now = new Date().toISOString();
    if (body.op === "refresh") {
      const tickers = Array.isArray(body.tickers) ? body.tickers : [];
      const refresh = await refreshScreener(db, tickers);
      return NextResponse.json({ ok: true, refresh, ...loadScreenerPage(db) });
    }
    if (body.op === "addTicker") {
      const added = addUserTicker(db, body.ticker ?? "", now);
      if (!added.ok) return NextResponse.json({ ok: false, error: added.error, ...loadScreenerPage(db) }, { status: 400 });
      return NextResponse.json({ ok: true, ...loadScreenerPage(db) });
    }
    if (body.op === "updateWar") {
      const ticker = (body.ticker ?? "").trim().toUpperCase();
      const rating = (body.rating ?? "").trim();
      if (!WAR_RATINGS.includes(rating as WarRating)) {
        return NextResponse.json({ ok: false, error: "Rating must be High, Medium, Low, Beneficiary, or n/a." }, { status: 400 });
      }
      const exists = db.prepare(`SELECT 1 FROM screener_security WHERE ticker = ?`).get(ticker);
      if (!exists) return NextResponse.json({ ok: false, error: "Ticker is not in the universe." }, { status: 400 });
      const sourceUrl = (body.sourceUrl ?? "").trim();
      if (sourceUrl && !/^https:\/\/\S+$/.test(sourceUrl)) {
        return NextResponse.json({ ok: false, error: "Source URL must be an https link." }, { status: 400 });
      }
      saveWarEdit(db, { ticker, rating, sourceUrl: sourceUrl || null, unverified: body.unverified !== false }, now);
      return NextResponse.json({ ok: true, ...loadScreenerPage(db) });
    }
    if (body.op === "savePreset") {
      const name = (body.name ?? "").trim();
      if (!name) return NextResponse.json({ ok: false, error: "Name the screen first." }, { status: 400 });
      savePreset(db, { id: `user-${Date.now()}`, name, filters: presetFilters(body.filters), builtIn: false }, now);
      return NextResponse.json({ ok: true, ...loadScreenerPage(db) });
    }
    if (body.op === "deletePreset") {
      deletePreset(db, body.id ?? "");
      return NextResponse.json({ ok: true, ...loadScreenerPage(db) });
    }
    return NextResponse.json({ ok: false, error: "Unknown request." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: message(error), name: SCREENER_NAME }, { status: 500 });
  }
}

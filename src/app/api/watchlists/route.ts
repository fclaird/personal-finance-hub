import { NextResponse } from "next/server";

import { logError } from "@/lib/log";
import { getDb } from "@/lib/db";
import { newId } from "@/lib/id";

export async function GET() {
  try {
    const db = getDb();
    const rows = db
      .prepare(
        `
      SELECT
        w.id AS id,
        w.name AS name,
        w.created_at AS createdAt,
        (SELECT COUNT(*) FROM watchlist_items wi WHERE wi.watchlist_id = w.id) AS itemCount
      FROM watchlists w
      ORDER BY w.created_at DESC, w.name ASC
    `,
      )
      .all() as Array<{ id: string; name: string; createdAt: string; itemCount: number }>;
    return NextResponse.json({ ok: true, watchlists: rows });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logError("api_watchlists_get", e);
    return NextResponse.json({ ok: false, error: msg, watchlists: [] }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { name?: string } | null;
  const name = (body?.name ?? "").trim();
  if (!name) return NextResponse.json({ ok: false, error: "Missing watchlist name" }, { status: 400 });

  const db = getDb();
  const id = newId("wl");
  db.prepare(`INSERT INTO watchlists (id, name) VALUES (?, ?)`).run(id, name);
  return NextResponse.json({ ok: true, id, name });
}


import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";

function normSym(s: string) {
  return (s ?? "").trim().toUpperCase();
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const watchlistId = (url.searchParams.get("watchlistId") ?? "").trim();
  if (!watchlistId) return NextResponse.json({ ok: false, error: "Missing watchlistId" }, { status: 400 });

  const db = getDb();
  const rows = db
    .prepare(
      `
      SELECT symbol, created_at AS createdAt
      FROM watchlist_items
      WHERE watchlist_id = ?
      ORDER BY created_at DESC, symbol ASC
    `,
    )
    .all(watchlistId) as Array<{ symbol: string; createdAt: string }>;
  return NextResponse.json({ ok: true, watchlistId, items: rows });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { watchlistId?: string; symbol?: string; op?: "add" | "remove" } | null;
  const watchlistId = (body?.watchlistId ?? "").trim();
  const symbol = normSym(body?.symbol ?? "");
  const op = body?.op ?? "add";

  if (!watchlistId) return NextResponse.json({ ok: false, error: "Missing watchlistId" }, { status: 400 });
  if (!symbol) return NextResponse.json({ ok: false, error: "Missing symbol" }, { status: 400 });
  if (op !== "add" && op !== "remove") return NextResponse.json({ ok: false, error: "Invalid op" }, { status: 400 });

  const db = getDb();
  if (op === "remove") {
    db.prepare(`DELETE FROM watchlist_items WHERE watchlist_id = ? AND symbol = ?`).run(watchlistId, symbol);
    return NextResponse.json({ ok: true, watchlistId, symbol, op });
  }

  // Ensure watchlist exists (nice error message)
  const exists = db.prepare(`SELECT 1 FROM watchlists WHERE id = ? LIMIT 1`).get(watchlistId);
  if (!exists) return NextResponse.json({ ok: false, error: "Unknown watchlistId" }, { status: 404 });

  db.prepare(`INSERT OR IGNORE INTO watchlist_items (watchlist_id, symbol) VALUES (?, ?)`).run(watchlistId, symbol);
  return NextResponse.json({ ok: true, watchlistId, symbol, op });
}


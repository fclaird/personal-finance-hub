import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { normSymbolNoteKey, readSymbolNote, upsertSymbolNote } from "@/lib/terminal/symbolNotes";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const symbol = normSymbolNoteKey(url.searchParams.get("symbol") ?? "");
  if (!symbol) return NextResponse.json({ ok: false, error: "Missing symbol" }, { status: 400 });

  const db = getDb();
  const row = readSymbolNote(db, symbol);
  return NextResponse.json({
    ok: true,
    symbol,
    body: row?.body ?? "",
    updatedAt: row?.updatedAt ?? null,
  });
}

export async function PUT(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const payload = body as { symbol?: string; body?: string };
  const symbol = normSymbolNoteKey(payload.symbol ?? "");
  if (!symbol) return NextResponse.json({ ok: false, error: "Missing symbol" }, { status: 400 });
  if (typeof payload.body !== "string") {
    return NextResponse.json({ ok: false, error: "Missing body" }, { status: 400 });
  }

  const db = getDb();
  const row = upsertSymbolNote(db, symbol, payload.body);
  return NextResponse.json({ ok: true, symbol: row.symbol, body: row.body, updatedAt: row.updatedAt });
}

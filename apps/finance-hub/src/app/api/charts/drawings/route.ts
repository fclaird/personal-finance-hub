import { NextResponse } from "next/server";

import { parseDrawingDocument } from "@/lib/charts/drawings";
import { readDrawingDocument, writeDrawingDocument } from "@/lib/charts/drawingStore";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function chartSymbol(raw: string): string | null {
  const symbol = raw.trim().toUpperCase().replace(/\./g, "-");
  if (!/^[A-Z][A-Z0-9-]{0,14}$/.test(symbol)) return null;
  return symbol;
}

/** Saved chart drawings for one ticker. Local SQLite only. */
export async function GET(req: Request) {
  const symbol = chartSymbol(new URL(req.url).searchParams.get("symbol") ?? "");
  if (!symbol) return NextResponse.json({ ok: false, error: "Missing symbol" }, { status: 400 });
  return NextResponse.json({ ok: true, symbol, document: readDrawingDocument(getDb(), symbol) });
}

export async function PUT(req: Request) {
  const text = await req.text();
  if (text.length > 200_000) return NextResponse.json({ ok: false, error: "Drawing document is too large" }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const record = body && typeof body === "object" ? (body as { symbol?: unknown; document?: unknown }) : {};
  const symbol = chartSymbol(typeof record.symbol === "string" ? record.symbol : "");
  if (!symbol) return NextResponse.json({ ok: false, error: "Missing symbol" }, { status: 400 });
  const document = parseDrawingDocument(record.document);
  if (!document) return NextResponse.json({ ok: false, error: "Invalid drawings" }, { status: 400 });
  writeDrawingDocument(getDb(), symbol, document);
  return NextResponse.json({ ok: true, symbol });
}

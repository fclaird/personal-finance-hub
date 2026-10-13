import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { deleteSnapshot, getSnapshot, listSnapshots, saveSnapshot } from "@/lib/strategyLab/snapshotStore";

/** Local Strategy Lab snapshots. Read and delete by id; list by symbol. No broker calls. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const db = getDb();
  if (id) {
    const snapshot = getSnapshot(db, id);
    if (!snapshot) return NextResponse.json({ ok: false, error: "Snapshot not found." }, { status: 404 });
    return NextResponse.json({ ok: true, snapshot });
  }
  const symbol = url.searchParams.get("symbol") ?? "";
  if (!symbol.trim()) return NextResponse.json({ ok: false, error: "Pass a symbol or an id." }, { status: 400 });
  return NextResponse.json({ ok: true, snapshots: listSnapshots(db, symbol) });
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "JSON body required." }, { status: 400 });
  }
  const result = saveSnapshot(getDb(), body);
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, snapshot: result.row });
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  const result = deleteSnapshot(getDb(), id);
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 404 });
  return NextResponse.json({ ok: true, id: result.id });
}

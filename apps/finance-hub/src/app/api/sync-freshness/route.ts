import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { syncShouldRun } from "@/lib/syncFreshness";
import { readSyncStamp } from "@/lib/syncStamp";

const KEY_RE = /^[a-z0-9._-]{1,80}$/;

export async function GET(req: Request) {
  const key = new URL(req.url).searchParams.get("key")?.trim() ?? "";
  if (!KEY_RE.test(key)) {
    return NextResponse.json({ ok: false, error: "Missing sync key" }, { status: 400 });
  }
  const nowMs = Date.now();
  const lastSuccessAt = readSyncStamp(getDb(), key);
  const fresh = !syncShouldRun({ force: false, lastSuccessAt, nowMs });
  return NextResponse.json({ ok: true, key, fresh, lastSuccessAt });
}

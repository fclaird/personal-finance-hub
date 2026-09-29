import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { runSchwabGreeksRefresh } from "@/lib/schwab/schwabGreeksRefresh";
import { SYNC_STAMP } from "@/lib/syncFreshness";
import { claimSync, recordSyncStamp } from "@/lib/syncStamp";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { force?: boolean };
  const db = getDb();
  if (claimSync(db, SYNC_STAMP.schwabGreeks, body.force === true) === "skip") {
    return NextResponse.json({ ok: true, skipped: true });
  }
  const result = await runSchwabGreeksRefresh();
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error ?? "Greeks refresh failed" },
      { status: result.error?.includes("No holdings") ? 400 : 500 },
    );
  }
  recordSyncStamp(db, SYNC_STAMP.schwabGreeks, new Date().toISOString());
  return NextResponse.json({
    ok: true,
    skipped: false,
    carryForwardApplied: result.carryForwardApplied,
    updated: result.updated,
    pricesUpdated: result.pricesUpdated,
    message: result.message,
  });
}

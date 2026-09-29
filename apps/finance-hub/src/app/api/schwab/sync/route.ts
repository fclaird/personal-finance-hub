import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { logError } from "@/lib/log";
import { DATA_MODE_COOKIE, parseDataMode } from "@/lib/dataMode";
import { runSchwabHoldingsSync } from "@/lib/schwab/holdingsSync";
import { SYNC_STAMP } from "@/lib/syncFreshness";
import { claimSync, recordSyncStamp } from "@/lib/syncStamp";

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { force?: boolean };
    const db = getDb();
    if (claimSync(db, SYNC_STAMP.schwabHoldings, body.force === true) === "skip") {
      return NextResponse.json({ ok: true, skipped: true });
    }
    const jar = await cookies();
    const mode = parseDataMode(jar.get(DATA_MODE_COOKIE)?.value);
    const result = await runSchwabHoldingsSync({ dataMode: mode });
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error ?? "Sync failed" }, { status: 500 });
    }
    recordSyncStamp(db, SYNC_STAMP.schwabHoldings, new Date().toISOString());
    return NextResponse.json({ ok: true, skipped: false, accounts: result.accounts });
  } catch (e) {
    logError("schwab_sync_failed", e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

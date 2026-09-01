import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { logError } from "@/lib/log";
import { syncBookForwardSnaps } from "@/lib/dividends/bookForwardSnap";
import { authorizeCronRequest } from "@/lib/internalCronAuth";
import { isUsEquityRegularSessionOpen } from "@/lib/market/usEquitySession";

/**
 * POST — backfill missing days and capture today's dividend-book forward NAV snap.
 * Auth: Bearer CRON_SECRET / x-cron-secret header only.
 */
export async function POST(req: Request) {
  if (!authorizeCronRequest(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const db = getDb();
    const rth = isUsEquityRegularSessionOpen(new Date());
    const result = await syncBookForwardSnaps(db, new Date(), {
      fetchLiveQuotes: rth,
      backfill: true,
    });
    return NextResponse.json(result);
  } catch (e) {
    logError("dividend_book_forward_snap_daily_failed", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

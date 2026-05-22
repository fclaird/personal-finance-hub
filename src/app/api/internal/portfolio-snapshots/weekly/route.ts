import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { DATA_MODE_COOKIE, parseDataMode } from "@/lib/dataMode";
import { getDb } from "@/lib/db";
import { logError } from "@/lib/log";
import { ensureBenchmarkHistory } from "@/lib/market/benchmarks";
import { authorizeCronRequest } from "@/lib/internalCronAuth";
import { upsertWeekEndingPortfolioSnapshots } from "@/lib/portfolio/snapshots";

/**
 * POST — refresh SPY/QQQ history if needed, then upsert week-ending portfolio snapshots for all buckets.
 * Auth: Bearer CRON_SECRET / x-cron-secret / ?secret= (same as other internal routes).
 * Optional JSON body: { "mode": "auto" | "schwab" } (overrides cookie when valid).
 */
export async function POST(req: Request) {
  if (!authorizeCronRequest(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    let mode = parseDataMode((await cookies()).get(DATA_MODE_COOKIE)?.value);
    try {
      const body = (await req.json().catch(() => null)) as { mode?: unknown } | null;
      if (body?.mode === "schwab" || body?.mode === "auto") mode = body.mode;
    } catch {
      /* ignore */
    }

    await ensureBenchmarkHistory("SPY");
    await ensureBenchmarkHistory("QQQ");

    const db = getDb();
    const n = upsertWeekEndingPortfolioSnapshots(db, mode, "cron_weekly");

    return NextResponse.json({ ok: true, mode, buckets_upserted: n });
  } catch (e) {
    logError("portfolio_snapshots_weekly_failed", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

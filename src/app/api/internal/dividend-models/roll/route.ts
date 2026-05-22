import { NextResponse } from "next/server";

import { authorizeCronRequest } from "@/lib/internalCronAuth";
import { getDb } from "@/lib/db";
import { logError } from "@/lib/log";
import { finalizeDividendModelRollups } from "@/lib/dividendModels/refresh";

async function runRoll(req: Request) {
  if (!authorizeCronRequest(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const db = getDb();
    const r = finalizeDividendModelRollups(db);
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    logError("dividend_models_roll_failed", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

/**
 * POST — finalize prior partial modeled month rows and prior-week forward snapshots.
 * Auth: same as other internal cron routes (CRON_SECRET).
 */
export async function POST(req: Request) {
  return runRoll(req);
}

/** GET — same as POST for Vercel Cron (GET invocations with `Authorization: Bearer CRON_SECRET`). */
export async function GET(req: Request) {
  return runRoll(req);
}

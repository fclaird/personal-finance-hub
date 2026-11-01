import { NextResponse } from "next/server";

import { lastCompletedNyWeekday } from "@/lib/analytics/allocationNyDate";
import { recordAllocationDailyCloseModes } from "@/lib/analytics/recordAllocationDailyClose";
import type { DataMode } from "@/lib/dataMode";
import { getDb } from "@/lib/db";
import { logError } from "@/lib/log";
import { authorizeCronRequest } from "@/lib/internalCronAuth";

/**
 * POST — snapshot allocation into allocation_daily_underlying for the NY session
 * whose cash close has finished (16:00 ET today). Weekends, holidays, and the
 * open session do not write. A second call the same evening does not replace
 * the first post-close snapshot.
 * Auth: Bearer CRON_SECRET / x-cron-secret header only.
 * Optional JSON body: { "tradeDate": "YYYY-MM-DD", "modes": ["auto","schwab"] }
 * `tradeDate` is written only when it is that finished session.
 */
export async function POST(req: Request) {
  if (!authorizeCronRequest(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    let tradeDate = lastCompletedNyWeekday();
    let modes: readonly DataMode[] = ["auto", "schwab"];
    try {
      const body = (await req.json().catch(() => null)) as {
        tradeDate?: unknown;
        modes?: unknown;
      } | null;
      if (body?.tradeDate && typeof body.tradeDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.tradeDate)) {
        tradeDate = body.tradeDate;
      }
      if (Array.isArray(body?.modes) && body.modes.length) {
        const m = body.modes.filter((x) => x === "auto" || x === "schwab") as DataMode[];
        if (m.length) modes = m;
      }
    } catch {
      /* use defaults */
    }

    const db = getDb();
    const { rowsWritten } = recordAllocationDailyCloseModes(db, tradeDate, modes);
    return NextResponse.json({
      ok: true,
      tradeDate,
      modes: [...modes],
      rowsWritten,
      skipped: rowsWritten === 0,
    });
  } catch (e) {
    logError("allocation_daily_close_post_failed", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

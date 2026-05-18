import { NextResponse } from "next/server";

import { startSchedulerOnce } from "@/lib/scheduler";
import { isSchwabDataStale, readSchwabRefreshStatus } from "@/lib/schwab/refreshStatus";

export async function GET() {
  try {
    startSchedulerOnce();
    const status = readSchwabRefreshStatus();
    return NextResponse.json({
      ok: true,
      ...status,
      stale: isSchwabDataStale(status),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

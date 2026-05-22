import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  queryAllocationUnderlyingHistory,
  type AllocationHistoryBucket,
  type AllocationHistoryMetric,
} from "@/lib/analytics/allocationUnderlyingHistoryQuery";
import { DATA_MODE_COOKIE, parseDataMode } from "@/lib/dataMode";
import { getDb } from "@/lib/db";
import { logError } from "@/lib/log";

function isBucket(s: string): s is AllocationHistoryBucket {
  return s === "net" || s === "brokerage" || s === "retirement";
}

function isMetric(s: string): s is AllocationHistoryMetric {
  return s === "net" || s === "spot" || s === "synthetic";
}

export async function GET(req: Request) {
  try {
    const jar = await cookies();
    const mode = parseDataMode(jar.get(DATA_MODE_COOKIE)?.value);
    const { searchParams } = new URL(req.url);
    const daysRaw = Number(searchParams.get("days") ?? "365");
    const days = Number.isFinite(daysRaw) ? Math.min(730, Math.max(1, Math.floor(daysRaw))) : 365;
    const bucketStr = searchParams.get("bucket") ?? "net";
    const metricStr = searchParams.get("metric") ?? "net";
    if (!isBucket(bucketStr)) {
      return NextResponse.json({ ok: false, error: "Invalid bucket" }, { status: 400 });
    }
    if (!isMetric(metricStr)) {
      return NextResponse.json({ ok: false, error: "Invalid metric" }, { status: 400 });
    }

    const db = getDb();
    const { dates, series } = queryAllocationUnderlyingHistory(db, {
      mode,
      bucket: bucketStr,
      metric: metricStr,
      days,
    });

    return NextResponse.json({ ok: true, mode, bucket: bucketStr, metric: metricStr, days, dates, series });
  } catch (e) {
    logError("allocation_underlying_history_get_failed", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

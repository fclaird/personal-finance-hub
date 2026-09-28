import { NextResponse } from "next/server";

import { loadInternalPerformance, type InternalPerformanceBucket } from "@/lib/analytics/internalPerformanceQuery";
import { getDb } from "@/lib/db";
import { logError } from "@/lib/log";
import { resolveViewScope } from "@/lib/viewScope";

const VALID_BUCKET = new Set<InternalPerformanceBucket>(["combined", "retirement", "brokerage"]);

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const bucket = (url.searchParams.get("bucket") ?? "combined") as InternalPerformanceBucket;
    if (!VALID_BUCKET.has(bucket)) {
      return NextResponse.json({ ok: false, error: "Invalid bucket" }, { status: 400 });
    }
    const { flavor } = await resolveViewScope();
    const chart = loadInternalPerformance(getDb(), flavor, bucket);
    return NextResponse.json({ ok: true, flavor, bucket, ...chart });
  } catch (e) {
    logError("performance_internal_get_failed", e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

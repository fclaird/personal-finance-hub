import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import {
  fetchPortfolioEquityMarkPriceMap,
  getUnderlyingExposureByBucket,
  rollupExposureBuckets,
} from "@/lib/analytics/optionsExposure";
import { getDb } from "@/lib/db";
import { DATA_MODE_COOKIE, parseDataMode } from "@/lib/dataMode";
import { ensureOptionGreeksOnLatestSnapshots } from "@/lib/schwab/ensureOptionGreeks";

export async function GET() {
  const jar = await cookies();
  const mode = parseDataMode(jar.get(DATA_MODE_COOKIE)?.value);
  ensureOptionGreeksOnLatestSnapshots();
  const db = getDb();
  const equityMarks = await fetchPortfolioEquityMarkPriceMap(db, mode);
  const buckets = getUnderlyingExposureByBucket(mode, equityMarks);
  const exposure = rollupExposureBuckets(buckets);
  return NextResponse.json({ ok: true, mode, exposure, buckets });
}


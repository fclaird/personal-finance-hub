import { NextResponse } from "next/server";

import {
  fetchPortfolioEquityMarkPriceMap,
  getUnderlyingExposureByBucket,
  rollupExposureBuckets,
} from "@/lib/analytics/optionsExposure";
import { getDb } from "@/lib/db";
import { resolveViewScope } from "@/lib/viewScope";
import { ensureFreshOptionData } from "@/lib/schwab/ensureOptionGreeks";

export async function GET() {
  const { flavor, dataMode: mode } = await resolveViewScope();
  await ensureFreshOptionData();
  const db = getDb();
  const equityMarks = await fetchPortfolioEquityMarkPriceMap(db, mode, flavor);
  const buckets = getUnderlyingExposureByBucket(mode, equityMarks, flavor);
  const exposure = rollupExposureBuckets(buckets);
  return NextResponse.json({ ok: true, mode, exposure, buckets });
}

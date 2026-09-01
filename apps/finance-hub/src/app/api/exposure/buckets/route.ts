import { NextResponse } from "next/server";

import { fetchPortfolioEquityMarkPriceMap, getUnderlyingExposureByBucket } from "@/lib/analytics/optionsExposure";
import { getDb } from "@/lib/db";
import { resolveViewScope } from "@/lib/viewScope";
import { ensureFreshOptionData } from "@/lib/schwab/ensureOptionGreeks";

export async function GET() {
  const { flavor, dataMode: mode } = await resolveViewScope();
  await ensureFreshOptionData();
  const db = getDb();
  const equityMarks = await fetchPortfolioEquityMarkPriceMap(db, mode, flavor);
  return NextResponse.json({ ok: true, mode, buckets: getUnderlyingExposureByBucket(mode, equityMarks, flavor) });
}

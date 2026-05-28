import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { getAllocationByAccount, getConsolidatedAllocation, type AllocationBucket } from "@/lib/analytics/allocation";
import {
  fetchPortfolioEquityMarkPriceMap,
  getUnderlyingExposureByBucket,
  rollupExposureBuckets,
} from "@/lib/analytics/optionsExposure";
import { getDb } from "@/lib/db";
import { DATA_MODE_COOKIE, parseDataMode } from "@/lib/dataMode";
import { logError } from "@/lib/log";
import { ensureOptionGreeksOnLatestSnapshots } from "@/lib/schwab/ensureOptionGreeks";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const includeSynthetic = url.searchParams.get("synthetic") !== "0";
    const jar = await cookies();
    const mode = parseDataMode(jar.get(DATA_MODE_COOKIE)?.value);
    const includeAllocation = url.searchParams.get("lite") !== "1";
    ensureOptionGreeksOnLatestSnapshots();
    const db = getDb();
    const equityMarks = await fetchPortfolioEquityMarkPriceMap(db, mode);
    const buckets = getUnderlyingExposureByBucket(mode, equityMarks);
    const exposure = rollupExposureBuckets(buckets);
    let byAssetClass: AllocationBucket[] = [];
    let totalMarketValue = 0;
    let accounts: Awaited<ReturnType<typeof getAllocationByAccount>> = [];
    let syntheticEquityMv = 0;

    if (includeAllocation) {
      const allocation = getConsolidatedAllocation(includeSynthetic, mode, equityMarks);
      byAssetClass = allocation.byAssetClass;
      totalMarketValue = allocation.totalMarketValue;
      syntheticEquityMv = includeSynthetic ? exposure.reduce((sum, e) => sum + e.syntheticMarketValue, 0) : 0;
      accounts = getAllocationByAccount(includeSynthetic, mode, equityMarks);
    } else {
      syntheticEquityMv = exposure.reduce((sum, e) => sum + e.syntheticMarketValue, 0);
    }

    return NextResponse.json({
      ok: true,
      mode,
      includeSynthetic,
      exposure,
      buckets,
      byAssetClass,
      totalMarketValue,
      syntheticEquityMv,
      accounts,
    });
  } catch (e) {
    logError("allocation_page_data_failed", e);
    const err = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: err }, { status: 500 });
  }
}

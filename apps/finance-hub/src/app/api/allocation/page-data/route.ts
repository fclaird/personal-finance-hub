import { NextResponse } from "next/server";

import { getAllocationByAccount, getConsolidatedAllocation, type AllocationBucket } from "@/lib/analytics/allocation";
import {
  fetchPortfolioEquityMarkPriceMap,
  getUnderlyingExposureByBucket,
  rollupExposureBuckets,
} from "@/lib/analytics/optionsExposure";
import { getDb } from "@/lib/db";
import { logError } from "@/lib/log";
import { ensureFreshOptionData } from "@/lib/schwab/ensureOptionGreeks";
import { resolveViewScope } from "@/lib/viewScope";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const includeSynthetic = url.searchParams.get("synthetic") !== "0";
    const { flavor, dataMode: mode } = await resolveViewScope();
    const includeAllocation = url.searchParams.get("lite") !== "1";
    await ensureFreshOptionData();
    const db = getDb();
    const equityMarks = await fetchPortfolioEquityMarkPriceMap(db, mode, flavor);
    const buckets = getUnderlyingExposureByBucket(mode, equityMarks, flavor);
    const exposure = rollupExposureBuckets(buckets);
    let byAssetClass: AllocationBucket[] = [];
    let totalMarketValue = 0;
    let accounts: Awaited<ReturnType<typeof getAllocationByAccount>> = [];
    let syntheticEquityMv = 0;

    if (includeAllocation) {
      const allocation = includeSynthetic
        ? {
            ...getConsolidatedAllocation(false, mode, undefined, flavor),
            syntheticEquityMv: exposure.reduce((sum, e) => sum + e.syntheticMarketValue, 0),
          }
        : { ...getConsolidatedAllocation(false, mode, undefined, flavor), syntheticEquityMv: 0 };
      if (includeSynthetic) {
        const byEquity = allocation.byAssetClass.find((b) => b.key === "equity");
        if (byEquity) byEquity.marketValue += allocation.syntheticEquityMv;
        else allocation.byAssetClass.push({ key: "equity", marketValue: allocation.syntheticEquityMv, weight: 0 });
        allocation.totalMarketValue = allocation.byAssetClass.reduce((sum, b) => sum + b.marketValue, 0);
        allocation.byAssetClass = allocation.byAssetClass
          .map((b) => ({ ...b, weight: allocation.totalMarketValue ? b.marketValue / allocation.totalMarketValue : 0 }))
          .sort((a, b) => b.marketValue - a.marketValue);
      }
      byAssetClass = allocation.byAssetClass;
      totalMarketValue = allocation.totalMarketValue;
      syntheticEquityMv = allocation.syntheticEquityMv;
      accounts = getAllocationByAccount(includeSynthetic, mode, equityMarks, flavor);
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

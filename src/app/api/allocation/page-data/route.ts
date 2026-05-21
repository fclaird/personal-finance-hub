import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { getAllocationByAccount, getConsolidatedAllocation } from "@/lib/analytics/allocation";
import { getUnderlyingExposureRollup } from "@/lib/analytics/optionsExposure";
import { DATA_MODE_COOKIE, parseDataMode } from "@/lib/dataMode";
import { logError } from "@/lib/log";
import { ensureOptionGreeksOnLatestSnapshots } from "@/lib/schwab/ensureOptionGreeks";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const includeSynthetic = url.searchParams.get("synthetic") !== "0";
    const jar = await cookies();
    const mode = parseDataMode(jar.get(DATA_MODE_COOKIE)?.value);
    ensureOptionGreeksOnLatestSnapshots();
    const exposure = getUnderlyingExposureRollup(mode);
    const allocation = includeSynthetic
      ? {
          ...getConsolidatedAllocation(false, mode),
          syntheticEquityMv: exposure.reduce((sum, e) => sum + e.syntheticMarketValue, 0),
        }
      : { ...getConsolidatedAllocation(false, mode), syntheticEquityMv: 0 };
    if (includeSynthetic) {
      const byEquity = allocation.byAssetClass.find((b) => b.key === "equity");
      if (byEquity) byEquity.marketValue += allocation.syntheticEquityMv;
      else allocation.byAssetClass.push({ key: "equity", marketValue: allocation.syntheticEquityMv, weight: 0 });
      allocation.totalMarketValue = allocation.byAssetClass.reduce((sum, b) => sum + b.marketValue, 0);
      allocation.byAssetClass = allocation.byAssetClass
        .map((b) => ({ ...b, weight: allocation.totalMarketValue ? b.marketValue / allocation.totalMarketValue : 0 }))
        .sort((a, b) => b.marketValue - a.marketValue);
    }
    const accounts = getAllocationByAccount(includeSynthetic, mode);

    return NextResponse.json({
      ok: true,
      mode,
      includeSynthetic,
      exposure,
      byAssetClass: allocation.byAssetClass,
      totalMarketValue: allocation.totalMarketValue,
      accounts,
    });
  } catch (e) {
    logError("allocation_page_data_failed", e);
    const err = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: err }, { status: 500 });
  }
}

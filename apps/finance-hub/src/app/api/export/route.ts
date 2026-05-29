import { NextResponse } from "next/server";

import { getConsolidatedAllocation, getAllocationByAccount } from "@/lib/analytics/allocation";
import { getGlanceAlignedPortfolioValueSeriesByBucket } from "@/lib/analytics/glanceAlignedPerformance";
import { fetchPortfolioEquityMarkPriceMap, getUnderlyingExposureRollup } from "@/lib/analytics/optionsExposure";
import { getRebalancing } from "@/lib/analytics/rebalancing";
import { getAlertEvents, getAlertRules } from "@/lib/alerts";
import { getGlobalTargets } from "@/lib/targets";
import { getDb } from "@/lib/db";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const includeSynthetic = url.searchParams.get("synthetic") !== "0";
  const db = getDb();
  const equityMarks = includeSynthetic ? await fetchPortfolioEquityMarkPriceMap(db) : undefined;

  return NextResponse.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    includeSynthetic,
    allocation: {
      consolidated: getConsolidatedAllocation(includeSynthetic, "auto", equityMarks),
      byAccount: getAllocationByAccount(includeSynthetic, "auto", equityMarks),
    },
    exposure: getUnderlyingExposureRollup("auto", equityMarks),
    performance: getGlanceAlignedPortfolioValueSeriesByBucket("combined", db),
    targets: getGlobalTargets(),
    rebalancing: getRebalancing(includeSynthetic, "auto", equityMarks),
    alerts: {
      rules: getAlertRules(),
      events: getAlertEvents(200),
    },
  });
}


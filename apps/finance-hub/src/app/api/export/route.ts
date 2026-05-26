import { NextResponse } from "next/server";

import { getConsolidatedAllocation, getAllocationByAccount } from "@/lib/analytics/allocation";
import { fetchPortfolioEquityMarkPriceMap, getUnderlyingExposureRollup } from "@/lib/analytics/optionsExposure";
import { getPortfolioValueSeries } from "@/lib/analytics/performance";
import { getRebalancing } from "@/lib/analytics/rebalancing";
import { getAlertEvents, getAlertRules } from "@/lib/alerts";
import { getGlobalTargets } from "@/lib/targets";
import { getDb } from "@/lib/db";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const includeSynthetic = url.searchParams.get("synthetic") !== "0";
  const equityMarks = includeSynthetic ? await fetchPortfolioEquityMarkPriceMap(getDb()) : undefined;

  return NextResponse.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    includeSynthetic,
    allocation: {
      consolidated: getConsolidatedAllocation(includeSynthetic, "auto", equityMarks),
      byAccount: getAllocationByAccount(includeSynthetic, "auto", equityMarks),
    },
    exposure: getUnderlyingExposureRollup("auto", equityMarks),
    performance: getPortfolioValueSeries(),
    targets: getGlobalTargets(),
    rebalancing: getRebalancing(includeSynthetic, "auto", equityMarks),
    alerts: {
      rules: getAlertRules(),
      events: getAlertEvents(200),
    },
  });
}


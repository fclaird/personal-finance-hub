import { NextResponse } from "next/server";

import { getConsolidatedAllocation, getAllocationByAccount } from "@/lib/analytics/allocation";
import { fetchPortfolioEquityMarkPriceMap, getUnderlyingExposureRollup } from "@/lib/analytics/optionsExposure";
import { getPortfolioValueSeries } from "@/lib/analytics/performance";
import { getRebalancing } from "@/lib/analytics/rebalancing";
import { getAlertEvents, getAlertRules } from "@/lib/alerts";
import { getGlobalTargets } from "@/lib/targets";
import { getDb } from "@/lib/db";
import { resolveViewScope } from "@/lib/viewScope";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const includeSynthetic = url.searchParams.get("synthetic") !== "0";
  const { flavor, dataMode: mode } = await resolveViewScope();
  const equityMarks = includeSynthetic
    ? await fetchPortfolioEquityMarkPriceMap(getDb(), mode, flavor)
    : undefined;

  return NextResponse.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    includeSynthetic,
    allocation: {
      consolidated: getConsolidatedAllocation(includeSynthetic, mode, equityMarks, flavor),
      byAccount: getAllocationByAccount(includeSynthetic, mode, equityMarks, flavor),
    },
    exposure: getUnderlyingExposureRollup(mode, equityMarks, flavor),
    performance: getPortfolioValueSeries(mode, flavor),
    targets: getGlobalTargets(),
    rebalancing: getRebalancing(includeSynthetic, mode, equityMarks, flavor),
    alerts: {
      rules: getAlertRules(),
      events: getAlertEvents(200),
    },
  });
}

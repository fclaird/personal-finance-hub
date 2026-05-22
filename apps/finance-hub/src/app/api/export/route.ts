import { NextResponse } from "next/server";

import { getConsolidatedAllocation, getAllocationByAccount } from "@/lib/analytics/allocation";
import { getUnderlyingExposureRollup } from "@/lib/analytics/optionsExposure";
import { getPortfolioValueSeries } from "@/lib/analytics/performance";
import { getRebalancing } from "@/lib/analytics/rebalancing";
import { getAlertEvents, getAlertRules } from "@/lib/alerts";
import { getGlobalTargets } from "@/lib/targets";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const includeSynthetic = url.searchParams.get("synthetic") !== "0";

  return NextResponse.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    includeSynthetic,
    allocation: {
      consolidated: getConsolidatedAllocation(includeSynthetic),
      byAccount: getAllocationByAccount(includeSynthetic),
    },
    exposure: getUnderlyingExposureRollup(),
    performance: getPortfolioValueSeries(),
    targets: getGlobalTargets(),
    rebalancing: getRebalancing(includeSynthetic),
    alerts: {
      rules: getAlertRules(),
      events: getAlertEvents(200),
    },
  });
}


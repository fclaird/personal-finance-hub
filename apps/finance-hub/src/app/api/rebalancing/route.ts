import { NextResponse } from "next/server";

import { getRebalancing } from "@/lib/analytics/rebalancing";
import { fetchPortfolioEquityMarkPriceMap } from "@/lib/analytics/optionsExposure";
import { getDb } from "@/lib/db";
import { resolveViewScope } from "@/lib/viewScope";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const includeSynthetic = url.searchParams.get("synthetic") !== "0";
  const { flavor, dataMode: mode } = await resolveViewScope();
  const equityMarks = includeSynthetic
    ? await fetchPortfolioEquityMarkPriceMap(getDb(), mode, flavor)
    : undefined;
  return NextResponse.json({ ok: true, ...getRebalancing(includeSynthetic, mode, equityMarks, flavor) });
}

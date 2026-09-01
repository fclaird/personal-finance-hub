import { NextResponse } from "next/server";

import { getAllocationByBucket } from "@/lib/analytics/allocation";
import { fetchPortfolioEquityMarkPriceMap } from "@/lib/analytics/optionsExposure";
import { getDb } from "@/lib/db";
import { ensureFreshOptionData } from "@/lib/schwab/ensureOptionGreeks";
import { resolveViewScope } from "@/lib/viewScope";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const includeSynthetic = url.searchParams.get("synthetic") !== "0";
  const { flavor, dataMode: mode } = await resolveViewScope();
  if (includeSynthetic) await ensureFreshOptionData();
  const equityMarks = includeSynthetic
    ? await fetchPortfolioEquityMarkPriceMap(getDb(), mode, flavor)
    : undefined;
  return NextResponse.json({ ok: true, ...getAllocationByBucket(includeSynthetic, mode, equityMarks, flavor) });
}

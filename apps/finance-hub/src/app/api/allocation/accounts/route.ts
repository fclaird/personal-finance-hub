import { NextResponse } from "next/server";

import { getAllocationByAccount } from "@/lib/analytics/allocation";
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
  const accounts = getAllocationByAccount(includeSynthetic, mode, equityMarks, flavor);
  return NextResponse.json({ ok: true, mode, includeSynthetic, accounts });
}

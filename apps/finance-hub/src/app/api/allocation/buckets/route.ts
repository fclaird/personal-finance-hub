import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { getAllocationByBucket } from "@/lib/analytics/allocation";
import { fetchPortfolioEquityMarkPriceMap } from "@/lib/analytics/optionsExposure";
import { getDb } from "@/lib/db";
import { DATA_MODE_COOKIE, parseDataMode } from "@/lib/dataMode";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const includeSynthetic = url.searchParams.get("synthetic") !== "0";
  const jar = await cookies();
  const mode = parseDataMode(jar.get(DATA_MODE_COOKIE)?.value);
  const equityMarks = includeSynthetic
    ? await fetchPortfolioEquityMarkPriceMap(getDb(), mode)
    : undefined;
  return NextResponse.json({ ok: true, ...getAllocationByBucket(includeSynthetic, mode, equityMarks) });
}


import { NextResponse } from "next/server";

import { getPortfolioValueSeries, getPortfolioValueSeriesByBucket } from "@/lib/analytics/performance";
import { resolveViewScope } from "@/lib/viewScope";

export async function GET() {
  const { flavor, dataMode: mode } = await resolveViewScope();
  return NextResponse.json({ ok: true, mode, series: getPortfolioValueSeries(mode, flavor) });
}

export async function POST(req: Request) {
  const { flavor, dataMode: mode } = await resolveViewScope();
  const body = (await req.json().catch(() => null)) as { bucket?: "combined" | "retirement" | "brokerage" } | null;
  const bucket = body?.bucket ?? "combined";
  return NextResponse.json({ ok: true, mode, bucket, series: getPortfolioValueSeriesByBucket(bucket, mode, flavor) });
}

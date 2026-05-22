import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { getPortfolioValueSeries, getPortfolioValueSeriesByBucket } from "@/lib/analytics/performance";
import { DATA_MODE_COOKIE, parseDataMode } from "@/lib/dataMode";

export async function GET() {
  // Default keeps backwards compat
  const jar = await cookies();
  const mode = parseDataMode(jar.get(DATA_MODE_COOKIE)?.value);
  return NextResponse.json({ ok: true, mode, series: getPortfolioValueSeries(mode) });
}

export async function POST(req: Request) {
  const jar = await cookies();
  const mode = parseDataMode(jar.get(DATA_MODE_COOKIE)?.value);
  const body = (await req.json().catch(() => null)) as { bucket?: "combined" | "retirement" | "brokerage" } | null;
  const bucket = body?.bucket ?? "combined";
  return NextResponse.json({ ok: true, mode, bucket, series: getPortfolioValueSeriesByBucket(bucket, mode) });
}


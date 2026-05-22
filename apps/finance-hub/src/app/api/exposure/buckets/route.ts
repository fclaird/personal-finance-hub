import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { getUnderlyingExposureByBucket } from "@/lib/analytics/optionsExposure";
import { DATA_MODE_COOKIE, parseDataMode } from "@/lib/dataMode";
import { ensureOptionGreeksOnLatestSnapshots } from "@/lib/schwab/ensureOptionGreeks";

export async function GET() {
  const jar = await cookies();
  const mode = parseDataMode(jar.get(DATA_MODE_COOKIE)?.value);
  ensureOptionGreeksOnLatestSnapshots();
  return NextResponse.json({ ok: true, mode, buckets: getUnderlyingExposureByBucket(mode) });
}


import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import {
  getUnderlyingExposureByBucket,
  rollupExposureBuckets,
} from "@/lib/analytics/optionsExposure";
import { DATA_MODE_COOKIE, parseDataMode } from "@/lib/dataMode";
import { ensureOptionGreeksOnLatestSnapshots } from "@/lib/schwab/ensureOptionGreeks";

export async function GET() {
  const jar = await cookies();
  const mode = parseDataMode(jar.get(DATA_MODE_COOKIE)?.value);
  ensureOptionGreeksOnLatestSnapshots();
  const buckets = getUnderlyingExposureByBucket(mode);
  const exposure = rollupExposureBuckets(buckets);
  return NextResponse.json({ ok: true, mode, exposure, buckets });
}


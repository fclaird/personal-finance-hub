import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { getUnderlyingExposureRollup } from "@/lib/analytics/optionsExposure";
import { DATA_MODE_COOKIE, parseDataMode } from "@/lib/dataMode";

export async function GET() {
  const jar = await cookies();
  const mode = parseDataMode(jar.get(DATA_MODE_COOKIE)?.value);
  return NextResponse.json({ ok: true, mode, exposure: getUnderlyingExposureRollup(mode) });
}


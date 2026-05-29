import { NextResponse } from "next/server";

import { getGlancePayloadCached } from "@/lib/terminal/glanceCache";

export async function GET() {
  try {
    const payload = await getGlancePayloadCached(new Date());
    return NextResponse.json(payload);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e), items: [] },
      { status: 500 },
    );
  }
}

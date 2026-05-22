import { NextResponse } from "next/server";

import { readDigestCache } from "@/lib/x/cacheDb";

export async function GET() {
  const payload = readDigestCache();
  if (!payload) {
    return NextResponse.json({ ok: true, empty: true, sections: [], posts: {}, generatedAt: null as string | null });
  }
  return NextResponse.json({ ok: true, empty: false, ...payload });
}

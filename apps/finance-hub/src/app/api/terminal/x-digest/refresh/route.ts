import { NextResponse } from "next/server";

import { refreshTimelineDigest } from "@/lib/x/refreshTimelineDigest";

/** User-triggered: fetch timeline, build digest, write SQLite cache, return payload. */
export async function POST() {
  const result = await refreshTimelineDigest();
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }
  const { payload, tweetCount } = result;
  return NextResponse.json({
    ok: true,
    empty: !payload.sections?.length,
    tweetCount,
    sections: payload.sections,
    posts: payload.posts,
    generatedAt: payload.generatedAt,
  });
}

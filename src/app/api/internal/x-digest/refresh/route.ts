import { NextResponse } from "next/server";

import { refreshTimelineDigest } from "@/lib/x/refreshTimelineDigest";
import { authorizeCronRequest } from "@/lib/internalCronAuth";

async function runRefresh(): Promise<NextResponse> {
  const result = await refreshTimelineDigest();
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }
  return NextResponse.json({
    ok: true,
    tweetCount: result.tweetCount,
    generatedAt: result.payload.generatedAt,
  });
}

export async function POST(req: Request) {
  if (!authorizeCronRequest(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  return runRefresh();
}

export async function GET(req: Request) {
  if (!authorizeCronRequest(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  return runRefresh();
}

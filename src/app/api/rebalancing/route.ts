import { NextResponse } from "next/server";

import { getRebalancing } from "@/lib/analytics/rebalancing";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const includeSynthetic = url.searchParams.get("synthetic") !== "0";
  return NextResponse.json({ ok: true, ...getRebalancing(includeSynthetic) });
}


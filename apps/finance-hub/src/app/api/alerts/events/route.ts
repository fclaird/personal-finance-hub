import { NextResponse } from "next/server";

import { getAlertEvents } from "@/lib/alerts";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Number(url.searchParams.get("limit") ?? "50");
  return NextResponse.json({ ok: true, events: getAlertEvents(Number.isFinite(limit) ? limit : 50) });
}


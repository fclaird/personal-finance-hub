import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { logError } from "@/lib/log";
import { reclassifyAllBrokerTransactions } from "@/lib/strategy/classifyTransaction";

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { since?: string };
    const since = typeof body.since === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.since) ? body.since : null;
    const db = getDb();
    const n = reclassifyAllBrokerTransactions(db, since);
    return NextResponse.json({ ok: true, reclassified: n });
  } catch (e) {
    logError("strategy_reclassify_failed", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

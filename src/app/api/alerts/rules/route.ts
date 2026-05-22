import { NextResponse } from "next/server";

import { getAlertRules, upsertAlertRule } from "@/lib/alerts";

export async function GET() {
  return NextResponse.json({ ok: true, rules: getAlertRules() });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as
    | { type?: "drift" | "concentration"; enabled?: boolean; config?: unknown }
    | null;
  if (!body?.type) return NextResponse.json({ ok: false, error: "Missing type" }, { status: 400 });
  upsertAlertRule(body.type, body.enabled ?? true, body.config ?? {});
  return NextResponse.json({ ok: true });
}


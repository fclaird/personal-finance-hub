import { NextResponse } from "next/server";

import { getGlobalTargets, setGlobalTargets, type Target } from "@/lib/targets";

export async function GET() {
  return NextResponse.json({ ok: true, targets: getGlobalTargets() });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { targets?: Target[] } | null;
  const targets = body?.targets ?? [];
  setGlobalTargets(targets);
  return NextResponse.json({ ok: true });
}


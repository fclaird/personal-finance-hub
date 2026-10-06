import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { buildRealEstatePayload } from "@/lib/realEstate/monthly";
import { parseValuationPayload, upsertValuations } from "@/lib/realEstate/store";
import { realEstateDenied } from "@/lib/realEstate/access";

export async function POST(req: Request) {
  const denied = await realEstateDenied();
  if (denied) return denied;
  const parsed = parseValuationPayload(await req.json().catch(() => null));
  if ("error" in parsed) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  try {
    const ids = upsertValuations(getDb(), parsed.readings);
    const dashboard = await buildRealEstatePayload();
    return NextResponse.json({ ...dashboard, ids });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}

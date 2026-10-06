import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { buildRealEstatePayload } from "@/lib/realEstate/monthly";
import { saveStatementBalance } from "@/lib/realEstate/store";
import { realEstateDenied } from "@/lib/realEstate/access";

export async function POST(req: Request) {
  const denied = await realEstateDenied();
  if (denied) return denied;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const propertyId = typeof body?.propertyId === "string" ? body.propertyId.trim() : "";
  const asOf = typeof body?.asOf === "string" ? body.asOf.trim() : "";
  const balanceUsd = typeof body?.balanceUsd === "number" ? body.balanceUsd : Number(body?.balanceUsd);
  const notes = typeof body?.notes === "string" ? body.notes.trim() || null : null;
  if (!propertyId) return NextResponse.json({ ok: false, error: "propertyId is required" }, { status: 400 });
  if (!Number.isFinite(balanceUsd)) return NextResponse.json({ ok: false, error: "balanceUsd is required" }, { status: 400 });
  try {
    saveStatementBalance(getDb(), propertyId, asOf, balanceUsd, notes);
    return NextResponse.json(await buildRealEstatePayload());
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}

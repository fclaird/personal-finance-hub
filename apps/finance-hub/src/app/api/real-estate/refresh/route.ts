import { NextResponse } from "next/server";

import { buildRealEstatePayload, runRealEstateMonthly } from "@/lib/realEstate/monthly";
import { realEstateDenied } from "@/lib/realEstate/access";

export async function POST() {
  const denied = await realEstateDenied();
  if (denied) return denied;
  const result = await runRealEstateMonthly({ force: true });
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error ?? "Index refresh failed" }, { status: 502 });
  const dashboard = await buildRealEstatePayload();
  return NextResponse.json({ ...dashboard, hpiObservations: result.observations });
}

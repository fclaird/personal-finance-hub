import { NextResponse } from "next/server";

import { buildRealEstatePayload } from "@/lib/realEstate/monthly";
import { realEstateDenied } from "@/lib/realEstate/access";

export async function GET() {
  const denied = await realEstateDenied();
  if (denied) return denied;
  try {
    return NextResponse.json(await buildRealEstatePayload());
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

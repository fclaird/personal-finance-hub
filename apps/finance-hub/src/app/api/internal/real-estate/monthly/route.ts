import { NextResponse } from "next/server";

import { authorizeCronRequest } from "@/lib/internalCronAuth";
import { runRealEstateMonthly } from "@/lib/realEstate/monthly";

/** POST — download FHFA HPI, rebuild official values, and amortize complete loans. */
export async function POST(req: Request) {
  if (!authorizeCronRequest(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const result = await runRealEstateMonthly({ force: true });
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}

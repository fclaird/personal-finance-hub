import { NextResponse } from "next/server";

import { apiAuthRequired } from "@/lib/apiAuth";

/** Public config for client UI (no secret exposed). */
export async function GET() {
  return NextResponse.json({
    ok: true,
    apiKeyRequired: apiAuthRequired(),
  });
}

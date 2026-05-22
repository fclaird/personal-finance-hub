import { NextResponse } from "next/server";

import { getDividendSummary } from "@/lib/analytics/dividends";

export async function GET() {
  return NextResponse.json({ ok: true, ...getDividendSummary() });
}


import { NextResponse } from "next/server";

import { getDividendMonthlySeries } from "@/lib/analytics/dividendsTimeseries";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const back = Number(url.searchParams.get("back") ?? "12");
  const fwd = Number(url.searchParams.get("fwd") ?? "12");
  return NextResponse.json({
    ok: true,
    series: getDividendMonthlySeries(Number.isFinite(back) ? back : 12, Number.isFinite(fwd) ? fwd : 12),
  });
}


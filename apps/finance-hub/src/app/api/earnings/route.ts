import { NextResponse } from "next/server";

import { isFinnhubConfigured } from "@/lib/earnings/finnhub";
import { listEarningsRanked } from "@/lib/earnings/store";

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const today = new Date().toISOString().slice(0, 10);
    const from = searchParams.get("from") ?? today;
    const to = searchParams.get("to") ?? addDays(today, 45);

    const rows = listEarningsRanked(from, to);
    const now = Date.now();

    const out = rows.map((r) => {
      const ed = new Date(`${r.earnings_date}T12:00:00Z`).getTime();
      const daysTo = Math.round((ed - now) / 86400000);
      return {
        ...r,
        days_to_earnings: daysTo,
      };
    });

    return NextResponse.json({
      ok: true,
      from,
      to,
      finnhubConfigured: isFinnhubConfigured(),
      rows: out,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

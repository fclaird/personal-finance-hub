import { NextResponse } from "next/server";

import { isFinnhubConfigured } from "@/lib/earnings/finnhub";
import { deleteDemoEarnings, seedDemoEarnings } from "@/lib/earnings/store";
import { syncEarningsFromFinnhub } from "@/lib/earnings/syncFinnhub";

type Body = {
  demo?: boolean;
  finnhub?: boolean;
  daysAhead?: number;
  symbolUniverseLimit?: number;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Body;

    if (body.demo) {
      deleteDemoEarnings();
      const n = seedDemoEarnings();
      return NextResponse.json({ ok: true, mode: "demo", events: n });
    }

    if (body.finnhub !== false && isFinnhubConfigured()) {
      const daysAhead = typeof body.daysAhead === "number" && body.daysAhead > 0 ? Math.min(body.daysAhead, 90) : 28;
      const symbolUniverseLimit =
        typeof body.symbolUniverseLimit === "number" && body.symbolUniverseLimit > 0
          ? Math.min(body.symbolUniverseLimit, 120)
          : 60;

      const result = await syncEarningsFromFinnhub({ daysAhead, symbolUniverseLimit });
      return NextResponse.json({ ok: true, mode: "finnhub", ...result });
    }

    return NextResponse.json(
      {
        ok: false,
        error:
          "No sync source available. Send { \"demo\": true } for sample rows, or set FINNHUB_API_KEY and omit demo to pull a public calendar + volume.",
      },
      { status: 400 },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { logError } from "@/lib/log";
import { ensureSituationsFresh } from "@/lib/situations/ensureSituationsFresh";
import { listSituations } from "@/lib/situations/persistSituations";
import {
  aggregateClosedRealized,
  parseRealizedPeriod,
  periodInQuery,
  realizedSummaryToCsv,
} from "@/lib/strategy/realizedByStrategy";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const period = parseRealizedPeriod(searchParams.get("period"));
    if (period == null) {
      return NextResponse.json(
        { ok: false, error: "Invalid period. Use all, ytd, or a four-digit year." },
        { status: 400 },
      );
    }

    const db = getDb();
    const fresh = ensureSituationsFresh(db);
    const summary = aggregateClosedRealized(listSituations(db), period);
    const format = searchParams.get("format") ?? "json";

    if (format === "csv") {
      return new NextResponse(realizedSummaryToCsv(summary), {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="strategy-realized-${periodInQuery(period)}.csv"`,
        },
      });
    }

    return NextResponse.json({
      ok: true,
      rebuilt: fresh.rebuilt,
      reason: fresh.reason,
      ...summary,
    });
  } catch (e) {
    logError("strategy_realized_get_failed", e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

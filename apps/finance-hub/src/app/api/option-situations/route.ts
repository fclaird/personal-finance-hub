import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { logError } from "@/lib/log";
import { ensureSituationsFresh } from "@/lib/situations/ensureSituationsFresh";
import { listSituations, situationsToCsv } from "@/lib/situations/persistSituations";

export async function GET(req: Request) {
  try {
    const db = getDb();
    const fresh = ensureSituationsFresh(db);
    const { searchParams } = new URL(req.url);
    const format = searchParams.get("format") ?? "json";
    const rows = listSituations(db);
    if (format === "csv") {
      return new NextResponse(situationsToCsv(rows), {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="option-situations.csv"`,
        },
      });
    }
    return NextResponse.json({
      ok: true,
      situations: rows,
      rebuilt: fresh.rebuilt,
      reason: fresh.reason,
      ...(fresh.proposed != null ? { proposed: fresh.proposed } : {}),
      ...(fresh.kept != null ? { kept: fresh.kept } : {}),
    });
  } catch (e) {
    logError("option_situations_get_failed", e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST() {
  try {
    const db = getDb();
    const result = ensureSituationsFresh(db, { force: true });
    const situations = listSituations(db);
    return NextResponse.json({
      ok: true,
      rebuilt: result.rebuilt,
      reason: result.reason,
      proposed: result.proposed ?? 0,
      kept: result.kept ?? 0,
      situations,
    });
  } catch (e) {
    logError("option_situations_propose_failed", e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

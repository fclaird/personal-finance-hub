import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { logError } from "@/lib/log";
import { listSituations, rebuildAutoSituations, situationsToCsv } from "@/lib/situations/persistSituations";
import { resolveViewScope } from "@/lib/viewScope";

export async function GET(req: Request) {
  try {
    const { flavor } = await resolveViewScope();
    const db = getDb();
    const { searchParams } = new URL(req.url);
    const format = searchParams.get("format") ?? "json";
    const rows = listSituations(db, flavor);
    if (format === "csv") {
      return new NextResponse(situationsToCsv(rows), {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="option-situations.csv"`,
        },
      });
    }
    return NextResponse.json({ ok: true, flavor, situations: rows });
  } catch (e) {
    logError("option_situations_get_failed", e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST() {
  try {
    const { flavor } = await resolveViewScope();
    const db = getDb();
    const result = rebuildAutoSituations(db);
    const situations = listSituations(db, flavor);
    return NextResponse.json({ ok: true, ...result, situations });
  } catch (e) {
    logError("option_situations_propose_failed", e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

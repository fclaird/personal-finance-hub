import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { buildSchwabDividendBook, buildSchwabDividendDashboard } from "@/lib/dividends/schwabDividendBook";
import { resolveViewScope } from "@/lib/viewScope";

export async function GET() {
  const db = getDb();
  const { flavor } = await resolveViewScope();
  const book = await buildSchwabDividendBook(db, { fetchLiveData: false, flavor });
  const dashboard = buildSchwabDividendDashboard(db, book.dividendRows);
  return NextResponse.json({ ok: true, dashboard });
}

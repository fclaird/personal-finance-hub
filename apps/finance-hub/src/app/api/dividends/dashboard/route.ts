import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { buildSchwabDividendBook, buildSchwabDividendDashboard } from "@/lib/dividends/schwabDividendBook";

export async function GET() {
  const db = getDb();
  const book = await buildSchwabDividendBook(db, { fetchLiveData: false });
  const dashboard = buildSchwabDividendDashboard(db, book.dividendRows);
  return NextResponse.json({ ok: true, dashboard });
}

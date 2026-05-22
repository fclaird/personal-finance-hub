import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { buildSchwabDividendBook } from "@/lib/dividends/schwabDividendBook";
import { getBookLiveStartedAt } from "@/lib/dividends/bookForwardSnap";

export async function GET() {
  const db = getDb();
  const book = await buildSchwabDividendBook(db, { fetchLiveData: false });
  const liveStartedAt = getBookLiveStartedAt(db);
  return NextResponse.json({
    ok: true,
    banner: book.banner,
    liveStartedAt,
    hasSchwabSnapshots: book.banner.snapshotAsOf != null,
  });
}

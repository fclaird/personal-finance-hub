import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { buildSchwabDividendBook } from "@/lib/dividends/schwabDividendBook";
import { getBookLiveStartedAt } from "@/lib/dividends/bookForwardSnap";
import { resolveViewScope } from "@/lib/viewScope";

export async function GET() {
  const db = getDb();
  const { flavor } = await resolveViewScope();
  const book = await buildSchwabDividendBook(db, { fetchLiveData: false, flavor });
  const liveStartedAt = getBookLiveStartedAt(db);
  return NextResponse.json({
    ok: true,
    banner: book.banner,
    liveStartedAt,
    hasSchwabSnapshots: book.banner.snapshotAsOf != null,
  });
}

import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { ensureFundamentalsSnapshotsFresh } from "@/lib/dividendModels/ensureFundamentals";
import {
  aggregateBySymbol,
  buildSchwabDividendBook,
  loadLatestSchwabPositionRows,
} from "@/lib/dividends/schwabDividendBook";
import { captureBookForwardSnap, ensureBookLiveStartedAt } from "@/lib/dividends/bookForwardSnap";

export async function POST() {
  const db = getDb();
  try {
    const raw = loadLatestSchwabPositionRows(db);
    const symbols = [...new Set(raw.map((r) => r.symbol.toUpperCase()))];
    await ensureFundamentalsSnapshotsFresh(db, symbols, undefined, true);

    const book = await buildSchwabDividendBook(db, {
      fetchLiveData: true,
      forceRefetchFundamentals: false,
    });

    ensureBookLiveStartedAt(db);
    const snap = await captureBookForwardSnap(db, new Date(), { fetchLiveQuotes: true });

    return NextResponse.json({
      ok: true,
      symbols: book.dividendRows.length,
      equitySymbols: aggregateBySymbol(raw).length,
      fundamentalsCaptured: symbols.length,
      forwardSnap: snap.ok,
      asOf: snap.asOf || null,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

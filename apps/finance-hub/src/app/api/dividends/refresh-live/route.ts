import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { ensureFundamentalsSnapshotsFresh } from "@/lib/dividends/ensureFundamentals";
import { SYNC_STAMP } from "@/lib/syncFreshness";
import { claimSync, recordSyncStamp } from "@/lib/syncStamp";
import {
  aggregateBySymbol,
  buildSchwabDividendBook,
  loadLatestSchwabPositionRows,
} from "@/lib/dividends/schwabDividendBook";
import { ensureBookLiveStartedAt, syncBookForwardSnaps } from "@/lib/dividends/bookForwardSnap";
import { resolveViewScope } from "@/lib/viewScope";

export async function POST(req: Request) {
  const db = getDb();
  const { flavor } = await resolveViewScope();
  const body = (await req.json().catch(() => ({}))) as { force?: boolean };
  if (claimSync(db, SYNC_STAMP.dividendsLive, body.force === true) === "skip") {
    return NextResponse.json({ ok: true, skipped: true });
  }
  try {
    const raw = loadLatestSchwabPositionRows(db, flavor);
    const symbols = [...new Set(raw.map((r) => r.symbol.toUpperCase()))];
    await ensureFundamentalsSnapshotsFresh(db, symbols, undefined, true);

    const book = await buildSchwabDividendBook(db, {
      fetchLiveData: true,
      forceRefetchFundamentals: false,
      flavor,
    });

    ensureBookLiveStartedAt(db);
    const snap = await syncBookForwardSnaps(db, new Date(), { fetchLiveQuotes: true, backfill: true });

    recordSyncStamp(db, SYNC_STAMP.dividendsLive, new Date().toISOString());
    return NextResponse.json({
      ok: true,
      skipped: false,
      symbols: book.dividendRows.length,
      equitySymbols: aggregateBySymbol(raw).length,
      fundamentalsCaptured: symbols.length,
      forwardSnap: snap.ok,
      asOf: snap.asOf || null,
      backfilled: snap.backfilled,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

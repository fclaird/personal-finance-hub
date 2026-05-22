import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { syncTaxonomyFromSchwab } from "@/lib/taxonomy";

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as {
      symbols?: unknown;
      /** When true, re-fetch Schwab fundamentals for every symbol in `symbols` and upsert `market_cap` (and other fields). */
      refreshMarketCapsFromSchwab?: unknown;
    } | null;
    const symbolsRaw = Array.isArray(body?.symbols) ? body?.symbols : [];
    const symbols = symbolsRaw.filter((s): s is string => typeof s === "string").map((s) => s.trim());

    const db = getDb();
    if (symbols.length === 0)
      return NextResponse.json({
        ok: true,
        requested: 0,
        missing: 0,
        needCapRefresh: 0,
        refreshAll: false,
        synced: 0,
        upserted: 0,
      });

    const upper = Array.from(new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean)));
    const ph = upper.map(() => "?").join(",");
    const known = db
      .prepare(
        `
      SELECT symbol FROM security_taxonomy
      WHERE symbol IN (${ph})
    `,
      )
      .all(...upper) as Array<{ symbol: string }>;
    const knownSet = new Set(known.map((r) => r.symbol.toUpperCase()));
    const missingRow = upper.filter((s) => !knownSet.has(s));

    const capRows = db
      .prepare(
        `
      SELECT symbol, market_cap AS marketCap
      FROM security_taxonomy
      WHERE symbol IN (${ph})
    `,
      )
      .all(...upper) as Array<{ symbol: string; marketCap: number | null }>;
    const capMap = new Map(capRows.map((r) => [r.symbol.toUpperCase(), r.marketCap]));
    const needCapRefresh = upper.filter((s) => {
      const c = capMap.get(s);
      return c == null || !Number.isFinite(c) || c <= 0;
    });

    const refreshAll = body?.refreshMarketCapsFromSchwab === true;
    const toSync = refreshAll ? upper : Array.from(new Set([...missingRow, ...needCapRefresh]));
    const res = await syncTaxonomyFromSchwab(toSync);
    return NextResponse.json({
      ok: true,
      requested: upper.length,
      missing: missingRow.length,
      needCapRefresh: needCapRefresh.length,
      refreshAll,
      synced: toSync.length,
      upserted: res.upserted,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}


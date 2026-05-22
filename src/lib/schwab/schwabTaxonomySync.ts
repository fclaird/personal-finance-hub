import type Database from "better-sqlite3";

import { getDb } from "@/lib/db";
import { syncTaxonomyFromSchwab } from "@/lib/taxonomy";
import { equitySymbolsFromLatestSnapshot } from "@/lib/schwab/schwabQuotesPersist";

export type SchwabTaxonomySyncResult = {
  ok: boolean;
  requested: number;
  synced: number;
  upserted: number;
  error?: string;
};

export async function runSchwabTaxonomySyncForPortfolio(
  db?: Database.Database,
  opts?: { refreshMarketCapsFromSchwab?: boolean },
): Promise<SchwabTaxonomySyncResult> {
  const database = db ?? getDb();
  const symbols = equitySymbolsFromLatestSnapshot(database);
  if (symbols.length === 0) {
    return { ok: true, requested: 0, synced: 0, upserted: 0 };
  }

  try {
    const upper = Array.from(new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean)));
    const ph = upper.map(() => "?").join(",");
    const known = database
      .prepare(`SELECT symbol FROM security_taxonomy WHERE symbol IN (${ph})`)
      .all(...upper) as Array<{ symbol: string }>;
    const knownSet = new Set(known.map((r) => r.symbol.toUpperCase()));
    const missingRow = upper.filter((s) => !knownSet.has(s));

    const capRows = database
      .prepare(
        `SELECT symbol, market_cap AS marketCap FROM security_taxonomy WHERE symbol IN (${ph})`,
      )
      .all(...upper) as Array<{ symbol: string; marketCap: number | null }>;
    const capMap = new Map(capRows.map((r) => [r.symbol.toUpperCase(), r.marketCap]));
    const needCapRefresh = upper.filter((s) => {
      const c = capMap.get(s);
      return c == null || !Number.isFinite(c) || c <= 0;
    });

    const refreshAll = opts?.refreshMarketCapsFromSchwab === true;
    const toSync = refreshAll ? upper : Array.from(new Set([...missingRow, ...needCapRefresh]));
    const res = await syncTaxonomyFromSchwab(toSync);
    return {
      ok: true,
      requested: upper.length,
      synced: toSync.length,
      upserted: res.upserted,
    };
  } catch (e) {
    return {
      ok: false,
      requested: symbols.length,
      synced: 0,
      upserted: 0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

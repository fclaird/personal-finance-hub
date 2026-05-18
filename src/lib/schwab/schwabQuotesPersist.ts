import type Database from "better-sqlite3";

import { getDb } from "@/lib/db";
import { schwabQuoteDisplayPrice } from "@/lib/market/schwabQuoteDisplay";
import { latestSnapshotId } from "@/lib/snapshots";
import { fetchSchwabQuotesResponse } from "@/lib/schwab/quotesFetch";
import { schwabQuoteObjectFromEntry } from "@/lib/schwab/quoteEntry";

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function pickPrice(quote: Record<string, unknown>): number | null {
  const rawLast = asNumber(quote.lastPrice) ?? null;
  const mark = asNumber(quote.mark) ?? null;
  const close = asNumber(quote.closePrice) ?? null;
  const display = schwabQuoteDisplayPrice(rawLast, mark, close);
  if (display != null && display > 0) return display;
  return (
    asNumber(quote.bid) ??
    asNumber(quote.ask) ??
    (close != null && close > 0 ? close : null) ??
    null
  );
}

export type SchwabQuotesPersistResult = {
  ok: boolean;
  updated: number;
  symbols: number;
  date: string;
  error?: string;
};

export function equitySymbolsFromLatestSnapshot(db: Database.Database): string[] {
  const snap = latestSnapshotId(db, "schwab") ?? latestSnapshotId(db);
  if (!snap) return [];
  const rows = db
    .prepare(
      `
      SELECT DISTINCT s.symbol AS symbol
      FROM positions p
      JOIN securities s ON s.id = p.security_id
      WHERE p.snapshot_id = ?
        AND s.symbol IS NOT NULL
        AND s.security_type != 'option'
    `,
    )
    .all(snap) as Array<{ symbol: string }>;
  return Array.from(new Set(rows.map((r) => (r.symbol ?? "").trim()).filter(Boolean)));
}

export async function runSchwabQuotesPersist(db?: Database.Database): Promise<SchwabQuotesPersistResult> {
  const database = db ?? getDb();
  const uniq = equitySymbolsFromLatestSnapshot(database);
  const today = new Date().toISOString().slice(0, 10);
  if (uniq.length === 0) {
    return { ok: true, updated: 0, symbols: 0, date: today };
  }

  try {
    const resp = await fetchSchwabQuotesResponse(uniq);
    const upsert = database.prepare(`
      INSERT INTO price_points (provider, symbol, date, close)
      VALUES ('schwab', @symbol, @date, @close)
      ON CONFLICT(provider, symbol, date) DO UPDATE SET close = excluded.close, created_at = datetime('now')
    `);

    let updated = 0;
    for (const sym of uniq) {
      const entry = resp[sym] ?? resp[sym.toUpperCase()];
      const quote = schwabQuoteObjectFromEntry(entry);
      if (!quote) continue;
      const px = pickPrice(quote);
      if (px == null || px <= 0) continue;
      upsert.run({ symbol: sym.toUpperCase(), date: today, close: px });
      updated++;
    }

    return { ok: true, updated, symbols: uniq.length, date: today };
  } catch (e) {
    return {
      ok: false,
      updated: 0,
      symbols: uniq.length,
      date: today,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

import type Database from "better-sqlite3";

import { getDb } from "@/lib/db";
import { schwabQuoteDisplayPrice } from "@/lib/market/schwabQuoteDisplay";
import { numbersDiffer } from "@/lib/sqlite/valueEqual";
import { latestSnapshotId } from "@/lib/snapshots";
import { fetchSchwabQuotesResponse } from "@/lib/schwab/quotesFetch";
import { schwabQuoteObjectFromEntry } from "@/lib/schwab/quoteEntry";

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

export function pickSchwabQuotePrice(quote: Record<string, unknown>): number | null {
  const rawLast = asNumber(quote.lastPrice) ?? null;
  const mark = asNumber(quote.mark) ?? null;
  const close = asNumber(quote.closePrice) ?? null;
  const display = schwabQuoteDisplayPrice(rawLast, mark, close);
  if (display != null && display > 0) return display;
  const bid = asNumber(quote.bidPrice ?? quote.bid);
  const ask = asNumber(quote.askPrice ?? quote.ask);
  const mid =
    bid != null && ask != null && bid > 0 && ask > 0 ? (bid + ask) / 2 : null;
  return mid ?? bid ?? ask ?? (close != null && close > 0 ? close : null);
}

export type SchwabQuotesPersistResult = {
  ok: boolean;
  updated: number;
  unchanged: number;
  symbols: number;
  date: string;
  error?: string;
};

export type QuoteCloseWrite = { symbol: string; date: string; close: number };

/**
 * Upsert closes, but do not touch a row whose close is already that value.
 * The old statement always set created_at = datetime('now'), so every scheduler
 * tick dirtied every symbol's page even when the price had not moved.
 */
export function writeQuoteCloses(
  db: Database.Database,
  rows: readonly QuoteCloseWrite[],
): { written: number; unchanged: number } {
  if (rows.length === 0) return { written: 0, unchanged: 0 };
  const existing = new Map<string, number>();
  const select = db.prepare(
    `SELECT symbol, close FROM price_points WHERE provider = 'schwab' AND date = ?`,
  );
  for (const date of new Set(rows.map((row) => row.date))) {
    const found = select.all(date) as Array<{ symbol: string; close: number }>;
    for (const row of found) existing.set(`${date}|${row.symbol.toUpperCase()}`, row.close);
  }
  const upsert = db.prepare(`
    INSERT INTO price_points (provider, symbol, date, close)
    VALUES ('schwab', @symbol, @date, @close)
    ON CONFLICT(provider, symbol, date) DO UPDATE SET close = excluded.close, created_at = datetime('now')
  `);
  let written = 0;
  let unchanged = 0;
  const tx = db.transaction(() => {
    for (const row of rows) {
      const symbol = row.symbol.toUpperCase();
      const prev = existing.get(`${row.date}|${symbol}`);
      if (prev != null && !numbersDiffer(prev, row.close)) {
        unchanged += 1;
        continue;
      }
      upsert.run({ symbol, date: row.date, close: row.close });
      existing.set(`${row.date}|${symbol}`, row.close);
      written += 1;
    }
  });
  tx();
  return { written, unchanged };
}

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
    return { ok: true, updated: 0, unchanged: 0, symbols: 0, date: today };
  }

  try {
    const resp = await fetchSchwabQuotesResponse(uniq);
    const rows: QuoteCloseWrite[] = [];
    for (const sym of uniq) {
      const entry = resp[sym] ?? resp[sym.toUpperCase()];
      const quote = schwabQuoteObjectFromEntry(entry);
      if (!quote) continue;
      const px = pickSchwabQuotePrice(quote);
      if (px == null || px <= 0) continue;
      rows.push({ symbol: sym, date: today, close: px });
    }
    const wrote = writeQuoteCloses(database, rows);
    return { ok: true, updated: wrote.written, unchanged: wrote.unchanged, symbols: uniq.length, date: today };
  } catch (e) {
    return {
      ok: false,
      updated: 0,
      unchanged: 0,
      symbols: uniq.length,
      date: today,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

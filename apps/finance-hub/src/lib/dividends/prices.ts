import type Database from "better-sqlite3";

import { getDb } from "@/lib/db";

/** Last daily close on or before `endMs` (inclusive) for Schwab 1d candles. */
export function closeOnOrBeforeTs(db: Database.Database, symbol: string, endMs: number): number | null {
  const sym = (symbol ?? "").trim().toUpperCase();
  const row = db
    .prepare(
      `
      SELECT close
      FROM ohlcv_points
      WHERE provider='schwab' AND symbol=? AND interval='1d' AND ts_ms <= ?
      ORDER BY ts_ms DESC
      LIMIT 1
    `,
    )
    .get(sym, endMs) as { close: number | null } | undefined;
  const c = row?.close;
  return typeof c === "number" && Number.isFinite(c) ? c : null;
}

export function closeOnOrBeforeIsoDate(symbol: string, isoDate: string): number | null {
  const endMs = new Date(`${isoDate}T23:59:59.999Z`).getTime();
  return closeOnOrBeforeTs(getDb(), symbol, endMs);
}

export function benchmarkCloseOnOrBefore(symbol: string, isoDate: string): number | null {
  const db = getDb();
  const sym = (symbol ?? "").trim().toUpperCase();
  const row = db
    .prepare(
      `
      SELECT pp.close AS close
      FROM price_points pp
      WHERE pp.provider='schwab' AND pp.symbol=? AND date(pp.date) <= date(?)
      ORDER BY pp.date DESC
      LIMIT 1
    `,
    )
    .get(sym, isoDate) as { close: number | null } | undefined;
  const c = row?.close;
  return typeof c === "number" && Number.isFinite(c) ? c : null;
}

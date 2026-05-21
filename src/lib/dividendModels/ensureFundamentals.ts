import type Database from "better-sqlite3";

import { logError } from "@/lib/log";
import { newId } from "@/lib/id";

import { fetchMergedDividendFundamentals } from "./mergedFundamentals";
import { readLatestStoredDisplayName } from "./symbolDisplayName";

const DEFAULT_MAX_AGE_MS = 4 * 60 * 60 * 1000;
/** When a snapshot exists but has no yield data, re-fetch after this interval (avoid hammering APIs on every navigation). */
const RETRY_MISSING_MS = 3 * 60 * 1000;

function shouldRefreshFundamental(db: Database.Database, symbol: string, maxAgeMs: number): boolean {
  const age = latestSnapAgeMs(db, symbol);
  if (age == null) return true;
  if (age >= maxAgeMs) return true;
  if (latestSnapMissingYield(db, symbol) && age >= RETRY_MISSING_MS) return true;
  if (!readLatestStoredDisplayName(db, symbol) && age >= RETRY_MISSING_MS) return true;
  return false;
}

function latestSnapAgeMs(db: Database.Database, symbol: string): number | null {
  const row = db
    .prepare(
      `
      SELECT captured_at AS capturedAt
      FROM dividend_model_symbol_fundamentals_snap
      WHERE symbol = ?
      ORDER BY captured_at DESC
      LIMIT 1
    `,
    )
    .get(symbol) as { capturedAt: string } | undefined;
  if (!row?.capturedAt) return null;
  const t = new Date(row.capturedAt).getTime();
  return Number.isFinite(t) ? Date.now() - t : null;
}

/** True when the latest row has no usable yield / annual estimate (re-fetch even if snapshot is “fresh”). */
function latestSnapMissingYield(db: Database.Database, symbol: string): boolean {
  const row = db
    .prepare(
      `
      SELECT div_yield AS d, annual_div_est AS a
      FROM dividend_model_symbol_fundamentals_snap
      WHERE symbol = ?
      ORDER BY captured_at DESC
      LIMIT 1
    `,
    )
    .get(symbol) as { d: number | null; a: number | null } | undefined;
  if (!row) return true;
  const has = (row.d != null && row.d > 0) || (row.a != null && row.a > 0);
  return !has;
}

async function upsertOneFundamental(db: Database.Database, sym: string): Promise<void> {
  const now = new Date().toISOString();
  const ins = db.prepare(
    `
    INSERT INTO dividend_model_symbol_fundamentals_snap
      (id, symbol, captured_at, display_name, div_yield, annual_div_est, next_ex_date, raw_json, source)
    VALUES
      (@id, @symbol, @captured_at, @display_name, @div_yield, @annual_div_est, @next_ex_date, @raw_json, @source)
  `,
  );
  try {
    const m = await fetchMergedDividendFundamentals(sym);
    ins.run({
      id: newId("dmfs"),
      symbol: sym,
      captured_at: now,
      display_name: m.displayName,
      div_yield: m.divYield,
      annual_div_est: m.annualDivEst,
      next_ex_date: m.nextExDate,
      raw_json: JSON.stringify(m.raw),
      source: m.source,
    });
  } catch (e) {
    logError(`dividend_model_table_fundamental_${sym}`, e);
  }
}

/**
 * Ensures recent fundamentals rows exist for symbols (used by holdings table on each load).
 * @param forceRefresh When true, re-fetch fundamentals for every symbol (ignores age / cache).
 */
export async function ensureFundamentalsSnapshotsFresh(
  db: Database.Database,
  symbols: string[],
  maxAgeMs: number = DEFAULT_MAX_AGE_MS,
  forceRefresh = false,
): Promise<void> {
  const uniq = Array.from(new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean)));
  const stale = forceRefresh ? uniq : uniq.filter((sym) => shouldRefreshFundamental(db, sym, maxAgeMs));
  const BATCH = 4;
  for (let i = 0; i < stale.length; i += BATCH) {
    const slice = stale.slice(i, i + BATCH);
    await Promise.all(slice.map((sym) => upsertOneFundamental(db, sym)));
  }
}

import type Database from "better-sqlite3";

import { newId } from "@/lib/id";
import { fetchYahooChartResult } from "@/lib/market/yahooChartFetch";

/** longName / shortName from a Yahoo chart `result` payload. */
export function extractYahooLongNameFromChartResult(result: Record<string, unknown>): string | null {
  const meta = result.meta as Record<string, unknown> | undefined;
  if (!meta) return null;
  const longName =
    typeof meta.longName === "string" && meta.longName.trim()
      ? meta.longName.trim()
      : typeof meta.shortName === "string" && meta.shortName.trim()
        ? meta.shortName.trim()
        : null;
  return longName;
}

export function readLatestStoredDisplayName(db: Database.Database, symbol: string): string | null {
  const row = db
    .prepare(
      `
      SELECT display_name AS displayName
      FROM dividend_model_symbol_fundamentals_snap
      WHERE symbol = ?
      ORDER BY captured_at DESC
      LIMIT 1
    `,
    )
    .get(symbol.trim().toUpperCase()) as { displayName: string | null } | undefined;
  const n = row?.displayName?.trim();
  return n && n.length > 0 ? n : null;
}

/**
 * Persist instrument display name on the latest fundamentals snapshot (or insert a minimal row).
 * Only writes when the latest row has no display name yet.
 */
export function patchLatestFundamentalsDisplayName(
  db: Database.Database,
  symbol: string,
  displayName: string,
  nameSource: string,
): boolean {
  const sym = symbol.trim().toUpperCase();
  const name = displayName.trim();
  if (!name) return false;

  const latest = db
    .prepare(
      `
      SELECT id, display_name AS displayName, raw_json AS rawJson, source
      FROM dividend_model_symbol_fundamentals_snap
      WHERE symbol = ?
      ORDER BY captured_at DESC
      LIMIT 1
    `,
    )
    .get(sym) as { id: string; displayName: string | null; rawJson: string | null; source: string } | undefined;

  if (latest?.displayName?.trim()) return false;

  if (latest) {
    let raw: Record<string, unknown> = {};
    if (latest.rawJson) {
      try {
        raw = JSON.parse(latest.rawJson) as Record<string, unknown>;
      } catch {
        raw = {};
      }
    }
    raw.companyName = name;
    const yahoo = (raw.yahoo && typeof raw.yahoo === "object" ? raw.yahoo : {}) as Record<string, unknown>;
    yahoo.longName = name;
    raw.yahoo = yahoo;

    const prevSource = latest.source?.trim() || "none";
    const source =
      prevSource === "none"
        ? nameSource
        : prevSource.includes(nameSource)
          ? prevSource
          : `${prevSource}+${nameSource}`;

    db.prepare(
      `UPDATE dividend_model_symbol_fundamentals_snap SET display_name = ?, raw_json = ?, source = ? WHERE id = ?`,
    ).run(name, JSON.stringify(raw), source, latest.id);
    return true;
  }

  const now = new Date().toISOString();
  db.prepare(
    `
    INSERT INTO dividend_model_symbol_fundamentals_snap
      (id, symbol, captured_at, display_name, div_yield, annual_div_est, next_ex_date, raw_json, source)
    VALUES
      (@id, @symbol, @captured_at, @display_name, NULL, NULL, NULL, @raw_json, @source)
  `,
  ).run({
    id: newId("dmfs"),
    symbol: sym,
    captured_at: now,
    display_name: name,
    raw_json: JSON.stringify({ companyName: name, yahoo: { longName: name } }),
    source: nameSource,
  });
  return true;
}

/** Fetch Yahoo chart meta and store display name when missing locally. */
export async function fetchAndPersistSymbolDisplayName(
  db: Database.Database,
  symbol: string,
): Promise<boolean> {
  if (readLatestStoredDisplayName(db, symbol)) return false;
  const chart = await fetchYahooChartResult(symbol, "div");
  if (!chart) return false;
  const name = extractYahooLongNameFromChartResult(chart.result);
  if (!name) return false;
  return patchLatestFundamentalsDisplayName(db, symbol, name, "yahoo_chart_meta");
}

/** Fill missing display names for portfolio symbols (one Yahoo request per missing symbol). */
export async function ensureSymbolDisplayNames(db: Database.Database, symbols: string[]): Promise<number> {
  const uniq = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  let updated = 0;
  for (const sym of uniq) {
    if (await fetchAndPersistSymbolDisplayName(db, sym)) updated += 1;
  }
  return updated;
}

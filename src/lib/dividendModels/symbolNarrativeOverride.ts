import type Database from "better-sqlite3";

import { getDb } from "@/lib/db";

const MAX_SUMMARY_CHARS = 2_000;

export function normNarrativeSymbol(symbol: string): string {
  return (symbol ?? "").trim().toUpperCase();
}

export function readSymbolNarrativeOverride(db: Database.Database, symbol: string): string | null {
  const sym = normNarrativeSymbol(symbol);
  if (!sym) return null;
  const row = db
    .prepare(`SELECT summary FROM symbol_narrative_override WHERE symbol = ? COLLATE NOCASE`)
    .get(sym) as { summary?: string } | undefined;
  const s = (row?.summary ?? "").trim();
  return s.length >= 20 ? s : null;
}

export function readSymbolNarrativeOverrideForSymbol(symbol: string): string | null {
  return readSymbolNarrativeOverride(getDb(), symbol);
}

export function upsertSymbolNarrativeOverride(db: Database.Database, symbol: string, summary: string): void {
  const sym = normNarrativeSymbol(symbol);
  if (!sym) throw new Error("Missing symbol");
  const text = summary.trim().slice(0, MAX_SUMMARY_CHARS);
  if (text.length < 20) throw new Error("Summary too short");
  const updatedAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO symbol_narrative_override (symbol, summary, updated_at)
     VALUES (@symbol, @summary, @updated_at)
     ON CONFLICT(symbol) DO UPDATE SET summary = excluded.summary, updated_at = excluded.updated_at`,
  ).run({ symbol: sym, summary: text, updated_at: updatedAt });
}

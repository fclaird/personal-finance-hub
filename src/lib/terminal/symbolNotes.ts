import type Database from "better-sqlite3";

const MAX_BODY_CHARS = 20_000;

export function normSymbolNoteKey(symbol: string): string {
  return (symbol ?? "").trim().toUpperCase();
}

export type SymbolNoteRow = {
  symbol: string;
  body: string;
  updatedAt: string;
};

export function readSymbolNote(db: Database.Database, symbol: string): SymbolNoteRow | null {
  const sym = normSymbolNoteKey(symbol);
  if (!sym) return null;
  const row = db
    .prepare(`SELECT symbol, body, updated_at AS updatedAt FROM symbol_notes WHERE symbol = ?`)
    .get(sym) as { symbol: string; body: string; updatedAt: string } | undefined;
  if (!row) return null;
  return { symbol: row.symbol, body: row.body ?? "", updatedAt: row.updatedAt };
}

export function upsertSymbolNote(db: Database.Database, symbol: string, body: string): SymbolNoteRow {
  const sym = normSymbolNoteKey(symbol);
  if (!sym) throw new Error("Missing symbol");
  const trimmed = body.length > MAX_BODY_CHARS ? body.slice(0, MAX_BODY_CHARS) : body;
  const updatedAt = new Date().toISOString();
  db.prepare(
    `
    INSERT INTO symbol_notes (symbol, body, updated_at)
    VALUES (@symbol, @body, @updated_at)
    ON CONFLICT(symbol) DO UPDATE SET
      body = excluded.body,
      updated_at = excluded.updated_at
  `,
  ).run({ symbol: sym, body: trimmed, updated_at: updatedAt });
  return { symbol: sym, body: trimmed, updatedAt };
}

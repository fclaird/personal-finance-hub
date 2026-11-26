import type Database from "better-sqlite3";

import type { DrawingDocument } from "@/lib/charts/drawings";
import { emptyDrawingDocument, parseDrawingDocument } from "@/lib/charts/drawings";

export function readDrawingDocument(db: Database.Database, symbol: string): DrawingDocument {
  const row = db.prepare(`SELECT document_json FROM chart_drawings WHERE symbol = ?`).get(symbol) as
    | { document_json: string }
    | undefined;
  if (!row) return emptyDrawingDocument();
  try {
    return parseDrawingDocument(JSON.parse(row.document_json)) ?? emptyDrawingDocument();
  } catch {
    return emptyDrawingDocument();
  }
}

export function writeDrawingDocument(db: Database.Database, symbol: string, document: DrawingDocument): void {
  db.prepare(
    `INSERT INTO chart_drawings (symbol, document_json, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(symbol) DO UPDATE SET document_json = excluded.document_json, updated_at = datetime('now')`,
  ).run(symbol, JSON.stringify(document));
}

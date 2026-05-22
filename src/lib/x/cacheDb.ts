import { getDb } from "@/lib/db";
import type { XDigestPayload, XSymbolPayload } from "@/lib/x/types";

const DIGEST_ID = "latest";

export function readDigestCache(): XDigestPayload | null {
  const db = getDb();
  const row = db.prepare("SELECT payload_json FROM x_digest_cache WHERE id = ?").get(DIGEST_ID) as
    | { payload_json: string }
    | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.payload_json) as XDigestPayload;
  } catch {
    return null;
  }
}

export function writeDigestCache(payload: XDigestPayload) {
  const db = getDb();
  const json = JSON.stringify(payload);
  const generatedAt = payload.generatedAt;
  db.prepare(
    `INSERT INTO x_digest_cache (id, generated_at, payload_json) VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET generated_at = excluded.generated_at, payload_json = excluded.payload_json`,
  ).run(DIGEST_ID, generatedAt, json);
}

export function readSymbolCache(symbol: string): XSymbolPayload | null {
  const db = getDb();
  const row = db.prepare("SELECT payload_json FROM x_symbol_cache WHERE symbol = ? COLLATE NOCASE").get(symbol) as
    | { payload_json: string }
    | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.payload_json) as XSymbolPayload;
  } catch {
    return null;
  }
}

export function writeSymbolCache(payload: XSymbolPayload) {
  const db = getDb();
  const json = JSON.stringify(payload);
  db.prepare(
    `INSERT INTO x_symbol_cache (symbol, generated_at, payload_json) VALUES (?, ?, ?)
     ON CONFLICT(symbol) DO UPDATE SET generated_at = excluded.generated_at, payload_json = excluded.payload_json`,
  ).run(payload.symbol.toUpperCase(), payload.generatedAt, json);
}

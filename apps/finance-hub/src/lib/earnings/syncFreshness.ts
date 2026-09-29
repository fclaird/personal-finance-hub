import type Database from "better-sqlite3";

/** Skip another Finnhub pull when the last successful sync is this recent. */
export const EARNINGS_FINNHUB_SYNC_FRESH_MS = 6 * 60 * 60 * 1000;

const META_KEY = "finnhub_synced_at";

function ensureMetaTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS earnings_sync_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

export function readEarningsFinnhubSyncedAt(db: Database.Database): string | null {
  ensureMetaTable(db);
  const row = db.prepare(`SELECT value AS value FROM earnings_sync_meta WHERE key = ?`).get(META_KEY) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function recordEarningsFinnhubSyncedAt(db: Database.Database, iso: string): void {
  ensureMetaTable(db);
  db.prepare(
    `
    INSERT INTO earnings_sync_meta (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `,
  ).run(META_KEY, iso);
}

export function earningsFinnhubSyncShouldRun(input: {
  force: boolean;
  lastSuccessAt: string | null;
  nowMs: number;
  windowMs?: number;
}): boolean {
  if (input.force) return true;
  if (!input.lastSuccessAt) return true;
  const at = Date.parse(input.lastSuccessAt);
  if (!Number.isFinite(at)) return true;
  const windowMs = input.windowMs ?? EARNINGS_FINNHUB_SYNC_FRESH_MS;
  return input.nowMs - at > windowMs;
}

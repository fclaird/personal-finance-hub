import type Database from "better-sqlite3";

import { syncShouldRun } from "@/lib/syncFreshness";

function ensureMetaTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

export function readSyncStamp(db: Database.Database, key: string): string | null {
  ensureMetaTable(db);
  const row = db.prepare(`SELECT value AS value FROM sync_meta WHERE key = ?`).get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function recordSyncStamp(db: Database.Database, key: string, iso: string): void {
  ensureMetaTable(db);
  db.prepare(
    `
    INSERT INTO sync_meta (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `,
  ).run(key, iso);
}

export function claimSync(db: Database.Database, key: string, force: boolean, nowMs: number = Date.now()): "run" | "skip" {
  if (!syncShouldRun({ force, lastSuccessAt: readSyncStamp(db, key), nowMs })) return "skip";
  return "run";
}

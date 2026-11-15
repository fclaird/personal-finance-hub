import fs from "node:fs";

import type Database from "better-sqlite3";

/**
 * Pages of WAL growth before SQLite checkpoints inside a commit.
 * 0 turns that hook off. The stacks from the hung next-server were
 * Statement.run → sqlite3WalDefaultHook → sqlite3_wal_checkpoint, on the
 * request thread, after Next finished gzipping the response.
 */
export const WAL_AUTOCHECKPOINT_PAGES = 0;

/** After a passive checkpoint, keep the WAL file from staying unbounded. */
export const JOURNAL_SIZE_LIMIT_BYTES = 32 * 1024 * 1024;

export function applyRuntimePragmas(db: Database.Database): void {
  db.pragma("journal_mode = WAL");
  // NORMAL is the WAL-safe setting. FULL fsyncs every commit, which is what
  // pushed the launchd agent through macOS's 2GB/day file-backed write budget.
  db.pragma("synchronous = NORMAL");
  db.pragma(`wal_autocheckpoint = ${WAL_AUTOCHECKPOINT_PAGES}`);
  db.pragma(`journal_size_limit = ${JOURNAL_SIZE_LIMIT_BYTES}`);
  db.pragma("busy_timeout = 1000");
  db.pragma("cache_size = -8000");
}

export type WalCheckpointResult = {
  busy: number;
  log: number;
  checkpointed: number;
};

/** Fold the WAL without waiting on other readers. Safe to call from the scheduler. */
export function readWalFileBytes(dbPath: string): number | null {
  try {
    return fs.statSync(`${dbPath}-wal`).size;
  } catch {
    return null;
  }
}

export function checkpointWalPassive(db: Database.Database): WalCheckpointResult {
  const rows = db.pragma("wal_checkpoint(PASSIVE)", { simple: false }) as unknown;
  const row = Array.isArray(rows) ? (rows[0] as WalCheckpointResult | undefined) : undefined;
  return {
    busy: Number(row?.busy ?? 0),
    log: Number(row?.log ?? 0),
    checkpointed: Number(row?.checkpointed ?? 0),
  };
}

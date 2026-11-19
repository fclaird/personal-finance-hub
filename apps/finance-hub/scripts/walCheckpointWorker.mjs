/**
 * Passive WAL checkpoint on a worker thread.
 * `PRAGMA wal_checkpoint` runs synchronously in the caller. On the request
 * thread that stalls /api/health for the whole copy. This process is the only
 * one blocked.
 */
import { parentPort, workerData } from "node:worker_threads";

import Database from "better-sqlite3";

const JOURNAL_SIZE_LIMIT_BYTES = 32 * 1024 * 1024;

try {
  const db = new Database(workerData.dbPath, { fileMustExist: true });
  try {
    db.pragma("busy_timeout = 2000");
    db.pragma(`journal_size_limit = ${JOURNAL_SIZE_LIMIT_BYTES}`);
    db.pragma("cache_size = -2048");
    db.pragma("mmap_size = 0");
    db.pragma("soft_heap_limit = 8388608");
    const rows = db.pragma("wal_checkpoint(PASSIVE)", { simple: false });
    const row = Array.isArray(rows) ? rows[0] : undefined;
    parentPort?.postMessage({
      ok: true,
      busy: Number(row?.busy ?? 0),
      log: Number(row?.log ?? 0),
      checkpointed: Number(row?.checkpointed ?? 0),
    });
  } finally {
    db.close();
  }
} catch (err) {
  parentPort?.postMessage({
    ok: false,
    error: err instanceof Error ? err.message : String(err),
  });
}

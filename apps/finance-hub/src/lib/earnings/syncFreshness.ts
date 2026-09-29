import type Database from "better-sqlite3";

import { SYNC_FRESH_MS, SYNC_STAMP, syncShouldRun } from "@/lib/syncFreshness";
import { readSyncStamp, recordSyncStamp } from "@/lib/syncStamp";

export const EARNINGS_FINNHUB_SYNC_FRESH_MS = SYNC_FRESH_MS;

export function readEarningsFinnhubSyncedAt(db: Database.Database): string | null {
  return readSyncStamp(db, SYNC_STAMP.earningsFinnhub);
}

export function recordEarningsFinnhubSyncedAt(db: Database.Database, iso: string): void {
  recordSyncStamp(db, SYNC_STAMP.earningsFinnhub, iso);
}

export function earningsFinnhubSyncShouldRun(input: {
  force: boolean;
  lastSuccessAt: string | null;
  nowMs: number;
  windowMs?: number;
}): boolean {
  return syncShouldRun(input);
}

import type Database from "better-sqlite3";

import { getDb } from "@/lib/db";
import { isUsEquityRegularSessionOpen } from "@/lib/market/usEquitySession";

export type SchwabRefreshStatus = {
  isRunning: boolean;
  rthOpen: boolean;
  lastSuccessAt: string | null;
  lastMode: string | null;
  lastFinishedAt: string | null;
  holdingsAsOf: string | null;
  quotesDate: string | null;
  staleThresholdMs: number;
  nextRecommendedAt: string | null;
};

export function schwabStaleThresholdMs(rthOpen?: boolean): number {
  const open = rthOpen ?? isUsEquityRegularSessionOpen(new Date());
  return open ? 60_000 : 600_000;
}

export function readSchwabRefreshStatus(db?: Database.Database): SchwabRefreshStatus {
  const database = db ?? getDb();
  const rthOpen = isUsEquityRegularSessionOpen(new Date());
  const staleThresholdMs = schwabStaleThresholdMs(rthOpen);

  const last = database
    .prepare(
      `
      SELECT mode, started_at, finished_at, ok, holdings_as_of
      FROM schwab_refresh_runs
      WHERE ok = 1 AND finished_at IS NOT NULL
      ORDER BY finished_at DESC
      LIMIT 1
    `,
    )
    .get() as
    | {
        mode: string;
        started_at: string;
        finished_at: string;
        ok: number;
        holdings_as_of: string | null;
      }
    | undefined;

  const holdingsRow = database
    .prepare(
      `
      SELECT MAX(as_of) AS as_of
      FROM holding_snapshots hs
      JOIN accounts a ON a.id = hs.account_id
      WHERE a.id LIKE 'schwab_%'
    `,
    )
    .get() as { as_of: string | null } | undefined;

  const quotesRow = database
    .prepare(
      `SELECT MAX(date) AS date FROM price_points WHERE provider = 'schwab'`,
    )
    .get() as { date: string | null } | undefined;

  const lastSuccessAt = last?.finished_at ?? null;
  let nextRecommendedAt: string | null = null;
  if (lastSuccessAt) {
    const next = new Date(lastSuccessAt).getTime() + staleThresholdMs;
    nextRecommendedAt = new Date(next).toISOString();
  }

  return {
    isRunning: Boolean(globalThis.__fhSchwabRefreshRunning),
    rthOpen,
    lastSuccessAt,
    lastMode: last?.mode ?? null,
    lastFinishedAt: last?.finished_at ?? null,
    holdingsAsOf: last?.holdings_as_of ?? holdingsRow?.as_of ?? null,
    quotesDate: quotesRow?.date ?? null,
    staleThresholdMs,
    nextRecommendedAt,
  };
}

export function isSchwabDataStale(status?: SchwabRefreshStatus): boolean {
  const s = status ?? readSchwabRefreshStatus();
  if (!s.lastSuccessAt) return true;
  const age = Date.now() - new Date(s.lastSuccessAt).getTime();
  return age > s.staleThresholdMs;
}

import type Database from "better-sqlite3";

import { getDb } from "@/lib/db";
import { logError } from "@/lib/log";
import { isUsEquityRegularSessionOpen } from "@/lib/market/usEquitySession";
import {
  carryForwardGreeksFromPriorSnapshots,
  getLatestSchwabSnapshotIds,
} from "@/lib/schwab/greeksCarryForward";
import { runSchwabHoldingsSync } from "@/lib/schwab/holdingsSync";
import { isSchwabDataStale, readSchwabRefreshStatus } from "@/lib/schwab/refreshStatus";
import { runSchwabGreeksRefresh } from "@/lib/schwab/schwabGreeksRefresh";
import { schwabStaleThresholdMs } from "@/lib/schwab/schwabStaleThreshold";

export type OptionDataFreshness = {
  hasOptionPositions: boolean;
  missingDeltaCount: number;
  latestGreeksUpdatedAt: string | null;
  holdingsAsOf: string | null;
  needsGreeksRefresh: boolean;
  needsHoldingsRefresh: boolean;
};

export type EnsureFreshOptionDataResult = {
  refreshed: boolean;
  holdingsSynced: boolean;
  greeksSynced: boolean;
  reason?: string;
  freshness: OptionDataFreshness;
};

declare global {
  // eslint-disable-next-line no-var
  var __fhOptionDataRefreshRunning: Promise<EnsureFreshOptionDataResult> | undefined;
}

function parseAgeMs(iso: string | null | undefined): number | null {
  if (!iso?.trim()) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? Date.now() - t : null;
}

function countOptionPositionsMissingDelta(db: Database.Database, snapshotIds: string[]): number {
  if (snapshotIds.length === 0) return 0;
  const snapshotsJson = JSON.stringify(snapshotIds);
  const row = db
    .prepare(
      `
      SELECT COUNT(*) AS c
      FROM positions p
      JOIN securities s ON s.id = p.security_id
      LEFT JOIN option_greeks og ON og.position_id = p.id
      WHERE p.snapshot_id IN (SELECT value FROM json_each(@snapshots_json))
        AND s.security_type = 'option'
        AND ABS(p.quantity) > 1e-9
        AND (
          og.position_id IS NULL
          OR og.delta IS NULL
          OR ABS(og.delta) <= 1e-12
        )
    `,
    )
    .get({ snapshots_json: snapshotsJson }) as { c: number };
  return row?.c ?? 0;
}

function readLatestGreeksUpdatedAt(db: Database.Database, snapshotIds: string[]): string | null {
  if (snapshotIds.length === 0) return null;
  const snapshotsJson = JSON.stringify(snapshotIds);
  const row = db
    .prepare(
      `
      SELECT MAX(og.updated_at) AS latest
      FROM positions p
      JOIN securities s ON s.id = p.security_id
      JOIN option_greeks og ON og.position_id = p.id
      WHERE p.snapshot_id IN (SELECT value FROM json_each(@snapshots_json))
        AND s.security_type = 'option'
        AND ABS(p.quantity) > 1e-9
    `,
    )
    .get({ snapshots_json: snapshotsJson }) as { latest: string | null } | undefined;
  return row?.latest ?? null;
}

function readLatestHoldingsAsOf(db: Database.Database): string | null {
  const row = db
    .prepare(
      `
      SELECT MAX(hs.as_of) AS as_of
      FROM holding_snapshots hs
      JOIN accounts a ON a.id = hs.account_id
      WHERE a.id LIKE 'schwab_%'
    `,
    )
    .get() as { as_of: string | null } | undefined;
  return row?.as_of ?? null;
}

function countOpenOptionPositions(db: Database.Database, snapshotIds: string[]): number {
  if (snapshotIds.length === 0) return 0;
  const snapshotsJson = JSON.stringify(snapshotIds);
  const row = db
    .prepare(
      `
      SELECT COUNT(*) AS c
      FROM positions p
      JOIN securities s ON s.id = p.security_id
      WHERE p.snapshot_id IN (SELECT value FROM json_each(@snapshots_json))
        AND s.security_type = 'option'
        AND ABS(p.quantity) > 1e-9
    `,
    )
    .get({ snapshots_json: snapshotsJson }) as { c: number };
  return row?.c ?? 0;
}

/** Inspect whether option greeks / holdings snapshots are stale for the latest Schwab snapshots. */
export function evaluateOptionDataFreshness(input: {
  openOptionCount: number;
  missingDeltaCount: number;
  latestGreeksUpdatedAt: string | null;
  holdingsAsOf: string | null;
  schwabRefreshStale: boolean;
  rthOpen?: boolean;
}): OptionDataFreshness {
  const hasOptionPositions = input.openOptionCount > 0;
  const rthOpen = input.rthOpen ?? isUsEquityRegularSessionOpen();
  const staleThresholdMs = schwabStaleThresholdMs(rthOpen);
  const greeksAgeMs = parseAgeMs(input.latestGreeksUpdatedAt);
  const holdingsAgeMs = parseAgeMs(input.holdingsAsOf);

  const needsGreeksRefresh =
    hasOptionPositions &&
    (input.missingDeltaCount > 0 ||
      greeksAgeMs == null ||
      greeksAgeMs > staleThresholdMs ||
      input.schwabRefreshStale);

  const needsHoldingsRefresh =
    hasOptionPositions && (holdingsAgeMs == null || holdingsAgeMs > staleThresholdMs);

  return {
    hasOptionPositions,
    missingDeltaCount: input.missingDeltaCount,
    latestGreeksUpdatedAt: input.latestGreeksUpdatedAt,
    holdingsAsOf: input.holdingsAsOf,
    needsGreeksRefresh,
    needsHoldingsRefresh,
  };
}

export function readOptionDataFreshness(db?: Database.Database): OptionDataFreshness {
  const database = db ?? getDb();
  const snapshotIds = getLatestSchwabSnapshotIds(database);
  return evaluateOptionDataFreshness({
    openOptionCount: countOpenOptionPositions(database, snapshotIds),
    missingDeltaCount: countOptionPositionsMissingDelta(database, snapshotIds),
    latestGreeksUpdatedAt: readLatestGreeksUpdatedAt(database, snapshotIds),
    holdingsAsOf: readLatestHoldingsAsOf(database),
    schwabRefreshStale: isSchwabDataStale(readSchwabRefreshStatus(database)),
  });
}

/**
 * After a holdings sync, position ids rotate but security_id is stable. Copy greeks from the
 * prior snapshot when the latest rows are missing deltas so allocation synthetic MV is correct.
 */
export function ensureOptionGreeksOnLatestSnapshots(db?: Database.Database): {
  carriedForward: number;
  missingAfter: number;
} {
  const database = db ?? getDb();
  const snapshotIds = getLatestSchwabSnapshotIds(database);
  const missingBefore = countOptionPositionsMissingDelta(database, snapshotIds);
  if (missingBefore === 0) {
    return { carriedForward: 0, missingAfter: 0 };
  }
  const carriedForward = carryForwardGreeksFromPriorSnapshots(database, snapshotIds);
  const missingAfter = countOptionPositionsMissingDelta(database, snapshotIds);
  return { carriedForward, missingAfter: missingAfter };
}

let lastOptionDataRefreshAt = 0;

async function runOptionDataRefresh(
  db: Database.Database,
  freshness: OptionDataFreshness,
): Promise<EnsureFreshOptionDataResult> {
  let holdingsSynced = false;
  let greeksSynced = false;

  try {
    if (freshness.needsHoldingsRefresh) {
      const holdings = await runSchwabHoldingsSync({ db });
      holdingsSynced = holdings.ok;
      ensureOptionGreeksOnLatestSnapshots(db);
    }

    const afterHoldings = readOptionDataFreshness(db);
    if (afterHoldings.needsGreeksRefresh || freshness.needsGreeksRefresh) {
      const greeks = await runSchwabGreeksRefresh(db);
      greeksSynced = greeks.ok;
    }

    lastOptionDataRefreshAt = Date.now();
    return {
      refreshed: holdingsSynced || greeksSynced,
      holdingsSynced,
      greeksSynced,
      freshness: readOptionDataFreshness(db),
    };
  } catch (e) {
    logError("option_data_refresh_failed", e);
    return {
      refreshed: false,
      holdingsSynced,
      greeksSynced,
      reason: e instanceof Error ? e.message : String(e),
      freshness: readOptionDataFreshness(db),
    };
  }
}

/**
 * Ensure Schwab option holdings and greeks are current before serving option-dependent APIs.
 * Coalesces concurrent callers and respects RTH/closed staleness thresholds.
 */
export async function ensureFreshOptionData(options?: {
  db?: Database.Database;
  force?: boolean;
}): Promise<EnsureFreshOptionDataResult> {
  const db = options?.db ?? getDb();
  ensureOptionGreeksOnLatestSnapshots(db);

  const freshness = readOptionDataFreshness(db);
  if (!freshness.hasOptionPositions) {
    return { refreshed: false, holdingsSynced: false, greeksSynced: false, reason: "no_options", freshness };
  }

  const needsRefresh = options?.force || freshness.needsGreeksRefresh || freshness.needsHoldingsRefresh;
  if (!needsRefresh) {
    return { refreshed: false, holdingsSynced: false, greeksSynced: false, reason: "fresh", freshness };
  }

  const rthOpen = isUsEquityRegularSessionOpen();
  const minIntervalMs = schwabStaleThresholdMs(rthOpen);
  if (
    !options?.force &&
    lastOptionDataRefreshAt > 0 &&
    Date.now() - lastOptionDataRefreshAt < minIntervalMs &&
    freshness.missingDeltaCount === 0
  ) {
    return { refreshed: false, holdingsSynced: false, greeksSynced: false, reason: "throttled", freshness };
  }

  if (globalThis.__fhSchwabRefreshRunning) {
    try {
      await globalThis.__fhSchwabRefreshRunning;
    } catch {
      // global refresh failed; still try a targeted option refresh below
    }
    ensureOptionGreeksOnLatestSnapshots(db);
    const afterGlobal = readOptionDataFreshness(db);
    if (!afterGlobal.needsGreeksRefresh && !afterGlobal.needsHoldingsRefresh) {
      return {
        refreshed: false,
        holdingsSynced: false,
        greeksSynced: false,
        reason: "waited_for_global_refresh",
        freshness: afterGlobal,
      };
    }
  }

  if (globalThis.__fhOptionDataRefreshRunning) {
    return globalThis.__fhOptionDataRefreshRunning;
  }

  const runPromise = runOptionDataRefresh(db, freshness);
  globalThis.__fhOptionDataRefreshRunning = runPromise;
  try {
    return await runPromise;
  } finally {
    globalThis.__fhOptionDataRefreshRunning = undefined;
  }
}

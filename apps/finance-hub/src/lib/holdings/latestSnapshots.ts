import type Database from "better-sqlite3";

import type { DataMode } from "@/lib/dataMode";
import { notPosterityWhereSql } from "@/lib/posterity";

export type LatestSnapshotScope = "all_synced" | "schwab_only";

/** All synced accounts: Schwab, manual, Plaid, etc. (excludes posterity + demo). */
export function allSyncedAccountsWhereSql(alias = "a"): string {
  return `${alias}.id NOT LIKE 'demo_%' AND ${notPosterityWhereSql(alias)}`;
}

/** Schwab broker + manual external accounts (excludes posterity + demo). Used for REAL data mode. */
export function syncedBrokerAndManualWhereSql(alias = "a"): string {
  return `(${alias}.id LIKE 'schwab_%' OR ${alias}.id LIKE 'manual_%') AND ${alias}.id NOT LIKE 'demo_%' AND ${notPosterityWhereSql(alias)}`;
}

export function latestSnapshotScopeForMode(mode: DataMode): LatestSnapshotScope {
  return mode === "schwab" ? "schwab_only" : "all_synced";
}

export function accountsInDataModeWhereSql(mode: DataMode, alias = "a"): string {
  return mode === "schwab" ? syncedBrokerAndManualWhereSql(alias) : allSyncedAccountsWhereSql(alias);
}

/**
 * Latest holding_snapshot id per account (one row per account).
 * `all_synced`: Schwab, manual, Plaid, etc. (excludes posterity + demo).
 * `schwab_only`: Schwab + manual external accounts (REAL data mode; excludes posterity + demo).
 */
export function latestSnapshotIds(db: Database.Database, scope: LatestSnapshotScope = "all_synced"): string[] {
  const accountFilter = scope === "schwab_only" ? syncedBrokerAndManualWhereSql("a") : allSyncedAccountsWhereSql("a");

  return (
    db
      .prepare(
        `
      SELECT hs.id AS snapshot_id
      FROM holding_snapshots hs
      JOIN accounts a ON a.id = hs.account_id
      WHERE ${accountFilter}
        AND hs.as_of = (
          SELECT MAX(hs2.as_of) FROM holding_snapshots hs2 WHERE hs2.account_id = a.id
        )
      ORDER BY a.name ASC
    `,
      )
      .all() as Array<{ snapshot_id: string }>
  ).map((r) => r.snapshot_id);
}

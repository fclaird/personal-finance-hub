import type Database from "better-sqlite3";

import type { DataMode } from "@/lib/dataMode";
import type { FlavorId } from "@/lib/flavor";
import { accountsInFlavorWhereSql } from "@/lib/flavors/accounts";
import { notPosterityWhereSql } from "@/lib/posterity";

function syncedAccountsBaseWhereSql(alias: string, flavor: FlavorId): string {
  return `${alias}.id NOT LIKE 'demo_%' AND ${notPosterityWhereSql(alias)} AND ${accountsInFlavorWhereSql(flavor, alias)}`;
}

export type LatestSnapshotScope = "all_synced" | "schwab_only";

/**
 * Fast join to each account's latest holding_snapshot (by max as_of).
 * Avoids a correlated MAX subquery that scans holding_snapshots once per account row.
 */
export function latestSnapshotPerAccountJoinSql(hsAlias = "hs"): string {
  return `JOIN (
    SELECT account_id, MAX(as_of) AS max_as_of
    FROM holding_snapshots
    GROUP BY account_id
  ) _latest_snap ON _latest_snap.account_id = ${hsAlias}.account_id AND _latest_snap.max_as_of = ${hsAlias}.as_of`;
}

/** All synced accounts for a flavor: Schwab, manual, Plaid, etc. (excludes posterity, demo). */
export function allSyncedAccountsWhereSql(flavor: FlavorId, alias = "a"): string {
  return syncedAccountsBaseWhereSql(alias, flavor);
}

/** Schwab broker + manual external accounts for a flavor (REAL data mode; excludes posterity, demo). */
export function syncedBrokerAndManualWhereSql(flavor: FlavorId, alias = "a"): string {
  return `(${alias}.id LIKE 'schwab_%' OR ${alias}.id LIKE 'manual_%') AND ${syncedAccountsBaseWhereSql(alias, flavor)}`;
}

export function latestSnapshotScopeForMode(mode: DataMode): LatestSnapshotScope {
  return mode === "schwab" ? "schwab_only" : "all_synced";
}

export function accountsInDataModeWhereSql(mode: DataMode, flavor: FlavorId, alias = "a"): string {
  return mode === "schwab" ? syncedBrokerAndManualWhereSql(flavor, alias) : allSyncedAccountsWhereSql(flavor, alias);
}

/** Combined flavor + data-mode account filter for analytics and terminal views. */
export function accountsInViewWhereSql(flavor: FlavorId, mode: DataMode, alias = "a"): string {
  return accountsInDataModeWhereSql(mode, flavor, alias);
}

/**
 * Latest holding_snapshot id per account (one row per account).
 * Scoped by flavor and data mode.
 */
export function latestSnapshotIds(
  db: Database.Database,
  scope: LatestSnapshotScope = "all_synced",
  flavor: FlavorId = "main",
): string[] {
  const accountFilter =
    scope === "schwab_only" ? syncedBrokerAndManualWhereSql(flavor, "a") : allSyncedAccountsWhereSql(flavor, "a");

  return (
    db
      .prepare(
        `
      SELECT hs.id AS snapshot_id
      FROM holding_snapshots hs
      JOIN accounts a ON a.id = hs.account_id
      ${latestSnapshotPerAccountJoinSql("hs")}
      WHERE ${accountFilter}
      ORDER BY a.name ASC
    `,
      )
      .all() as Array<{ snapshot_id: string }>
  ).map((r) => r.snapshot_id);
}

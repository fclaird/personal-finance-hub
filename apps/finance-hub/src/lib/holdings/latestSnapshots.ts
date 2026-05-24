import type Database from "better-sqlite3";

import { notPosterityWhereSql } from "@/lib/posterity";

export type LatestSnapshotScope = "all_synced" | "schwab_only";

/**
 * Latest holding_snapshot id per account (one row per account).
 * `all_synced`: Schwab, manual, Plaid, etc. (excludes posterity + demo).
 * `schwab_only`: legacy Schwab-only filter.
 */
export function latestSnapshotIds(db: Database.Database, scope: LatestSnapshotScope = "all_synced"): string[] {
  const accountFilter =
    scope === "schwab_only"
      ? `a.id LIKE 'schwab_%' AND ${notPosterityWhereSql("a")}`
      : `a.id NOT LIKE 'demo_%' AND ${notPosterityWhereSql("a")}`;

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

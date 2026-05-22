import type Database from "better-sqlite3";

import { type DataMode } from "@/lib/dataMode";
import { notPosterityWhereSql } from "@/lib/posterity";

export function latestSnapshotId(db: Database.Database, mode?: DataMode): string | null {
  const m = mode ?? "auto";

  const row =
    m === "schwab"
      ? (db
          .prepare(
            `
            SELECT hs.id AS snapshot_id
            FROM holding_snapshots hs
            JOIN accounts a ON a.id = hs.account_id
            WHERE a.id LIKE 'schwab_%'
              AND ${notPosterityWhereSql("a")}
            ORDER BY hs.as_of DESC
            LIMIT 1
          `,
          )
          .get() as { snapshot_id: string } | undefined)
      : (db
          .prepare(
            `
            SELECT hs.id AS snapshot_id
            FROM holding_snapshots hs
            JOIN accounts a ON a.id = hs.account_id
            WHERE a.id NOT LIKE 'demo_%'
              AND ${notPosterityWhereSql("a")}
            ORDER BY hs.as_of DESC
            LIMIT 1
          `,
          )
          .get() as { snapshot_id: string } | undefined);

  return row?.snapshot_id ?? null;
}

export function snapshotAvailability(db: Database.Database): { hasSchwab: boolean } {
  const hasSchwab = !!db
    .prepare(
      `
      SELECT 1
      FROM holding_snapshots hs
      JOIN accounts a ON a.id = hs.account_id
      WHERE a.id LIKE 'schwab_%'
        AND ${notPosterityWhereSql("a")}
      LIMIT 1
    `,
    )
    .get();
  return { hasSchwab };
}


import type Database from "better-sqlite3";

import { getDb } from "@/lib/db";
import {
  carryForwardGreeksFromPriorSnapshots,
  getLatestSchwabSnapshotIds,
} from "@/lib/schwab/greeksCarryForward";

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

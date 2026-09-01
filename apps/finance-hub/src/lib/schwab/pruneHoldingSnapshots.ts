import type Database from "better-sqlite3";

const DEFAULT_KEEP_PER_ACCOUNT = 7;

/**
 * Delete old holding snapshots beyond the newest N per account (positions cascade).
 * Returns number of snapshots removed.
 */
export function pruneHoldingSnapshots(
  db: Database.Database,
  keepPerAccount = DEFAULT_KEEP_PER_ACCOUNT,
): number {
  if (keepPerAccount < 1) return 0;
  const result = db
    .prepare(
      `
      DELETE FROM holding_snapshots
      WHERE id IN (
        SELECT hs.id
        FROM holding_snapshots hs
        WHERE (
          SELECT COUNT(*)
          FROM holding_snapshots newer
          WHERE newer.account_id = hs.account_id
            AND (
              newer.as_of > hs.as_of
              OR (newer.as_of = hs.as_of AND newer.id > hs.id)
            )
        ) >= @keep
      )
    `,
    )
    .run({ keep: keepPerAccount });
  return result.changes;
}

/** Drop schwab_refresh_runs older than retentionDays (default 30). */
export function pruneSchwabRefreshRuns(db: Database.Database, retentionDays = 30): number {
  if (retentionDays < 1) return 0;
  const cutoff = new Date(Date.now() - retentionDays * 24 * 3600 * 1000).toISOString();
  const result = db
    .prepare(`DELETE FROM schwab_refresh_runs WHERE finished_at IS NOT NULL AND finished_at < ?`)
    .run(cutoff);
  return result.changes;
}

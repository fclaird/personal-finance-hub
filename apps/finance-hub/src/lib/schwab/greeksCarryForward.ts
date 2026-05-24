import Database from "better-sqlite3";

import { getDb } from "@/lib/db";
import { latestSnapshotPerAccountJoinSql } from "@/lib/holdings/latestSnapshots";
import { newId } from "@/lib/id";
import { latestSnapshotId } from "@/lib/snapshots";
import { notPosterityWhereSql } from "@/lib/posterity";

/**
 * Latest holding_snapshots.id per Schwab account (matches Positions / refresh-greeks).
 */
export function getLatestSchwabSnapshotIds(db: Database.Database): string[] {
  const snaps = db
    .prepare(
      `
      SELECT hs.id AS snapshot_id
      FROM holding_snapshots hs
      JOIN accounts a ON a.id = hs.account_id
      ${latestSnapshotPerAccountJoinSql("hs")}
      WHERE a.id LIKE 'schwab_%'
        AND ${notPosterityWhereSql("a")}
      ORDER BY a.name ASC
    `,
    )
    .all() as Array<{ snapshot_id: string }>;

  const ids = snaps.map((r) => r.snapshot_id);
  if (ids.length > 0) return ids;

  const latest = latestSnapshotId(db, "schwab") ?? latestSnapshotId(db);
  return latest ? [latest] : [];
}

/**
 * Schwab sync creates new position rows each run; option_greeks are keyed by position_id.
 * Copy last known Greeks from an older snapshot for the same account + option security when the current row lacks delta.
 *
 * Donor selection excludes the current snapshot id (fixes ties when `as_of` strings match) and orders by `as_of`, then `created_at`.
 */
export function carryForwardGreeksFromPriorSnapshots(db: Database.Database, snapshotIds: string[]): number {
  if (snapshotIds.length === 0) return 0;

  const snapshotsJson = JSON.stringify(snapshotIds);

  const rows = db
    .prepare(
      `
      SELECT p.id AS position_id, p.security_id AS security_id, hs.account_id AS account_id, hs.id AS snapshot_id
      FROM positions p
      JOIN holding_snapshots hs ON hs.id = p.snapshot_id
      JOIN securities s ON s.id = p.security_id
      WHERE p.snapshot_id IN (SELECT value FROM json_each(@snapshots_json))
        AND s.security_type = 'option'
    `,
    )
    .all({ snapshots_json: snapshotsJson }) as Array<{
    position_id: string;
    security_id: string;
    account_id: string;
    snapshot_id: string;
  }>;

  const findDonor = db.prepare(
    `
    SELECT og.delta, og.gamma, og.theta, og.vega, og.iv
    FROM positions p2
    JOIN holding_snapshots hs2 ON hs2.id = p2.snapshot_id
    JOIN option_greeks og ON og.position_id = p2.id
    WHERE hs2.account_id = @account_id
      AND p2.security_id = @security_id
      AND hs2.id <> @snapshot_id
      AND og.delta IS NOT NULL
      AND ABS(og.delta) > 1e-12
    ORDER BY hs2.as_of DESC, hs2.created_at DESC
    LIMIT 1
    `,
  );

  const upsertCarried = db.prepare(`
    INSERT INTO option_greeks (id, position_id, delta, gamma, theta, vega, iv, updated_at)
    VALUES (@id, @position_id, @delta, @gamma, @theta, @vega, @iv, datetime('now'))
    ON CONFLICT(position_id) DO UPDATE SET
      delta = COALESCE(option_greeks.delta, excluded.delta),
      gamma = COALESCE(option_greeks.gamma, excluded.gamma),
      theta = COALESCE(option_greeks.theta, excluded.theta),
      vega = COALESCE(option_greeks.vega, excluded.vega),
      iv = COALESCE(option_greeks.iv, excluded.iv),
      updated_at = CASE
        WHEN option_greeks.delta IS NULL AND excluded.delta IS NOT NULL THEN excluded.updated_at
        ELSE option_greeks.updated_at
      END
  `);

  let copied = 0;
  for (const r of rows) {
    const hasDelta = db
      .prepare(`SELECT delta FROM option_greeks WHERE position_id = ?`)
      .get(r.position_id) as { delta: number | null } | undefined;
    if (
      hasDelta != null &&
      hasDelta.delta != null &&
      Number.isFinite(hasDelta.delta) &&
      Math.abs(hasDelta.delta) > 1e-12
    ) {
      continue;
    }

    const donor = findDonor.get({
      account_id: r.account_id,
      security_id: r.security_id,
      snapshot_id: r.snapshot_id,
    }) as
      | {
          delta: number | null;
          gamma: number | null;
          theta: number | null;
          vega: number | null;
          iv: number | null;
        }
      | undefined;
    if (!donor || donor.delta == null || !Number.isFinite(donor.delta)) continue;

    upsertCarried.run({
      id: newId("greek"),
      position_id: r.position_id,
      delta: donor.delta,
      gamma: donor.gamma,
      theta: donor.theta,
      vega: donor.vega,
      iv: donor.iv,
    });
    copied++;
  }
  return copied;
}

/** Convenience: open DB and carry forward using latest Schwab snapshots (e.g. after HTTP handlers). */
export function carryForwardLatestSchwabGreeks(): number {
  const db = getDb();
  return carryForwardGreeksFromPriorSnapshots(db, getLatestSchwabSnapshotIds(db));
}

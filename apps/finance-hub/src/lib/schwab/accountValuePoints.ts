import type Database from "better-sqlite3";

/** Bucket account value timestamps to the start of the minute (UTC). */
export function bucketAccountValueAsOf(nowMs = Date.now()): string {
  return new Date(Math.floor(nowMs / 60_000) * 60_000).toISOString();
}

const MIN_EQUITY_DELTA_USD = 0.5;

/** Skip write when latest point for account is within the same minute bucket with negligible equity change. */
export function shouldSkipAccountValueWrite(
  db: Database.Database,
  accountId: string,
  asOf: string,
  equity: number,
): boolean {
  const row = db
    .prepare(
      `SELECT as_of AS asOf, equity_value AS equityValue
       FROM account_value_points
       WHERE account_id = ?
       ORDER BY as_of DESC
       LIMIT 1`,
    )
    .get(accountId) as { asOf: string; equityValue: number } | undefined;
  if (!row) return false;
  const rowBucket = bucketAccountValueAsOf(Date.parse(row.asOf));
  const nextBucket = bucketAccountValueAsOf(Date.parse(asOf));
  if (rowBucket !== nextBucket) return false;
  return Math.abs(row.equityValue - equity) < MIN_EQUITY_DELTA_USD;
}

/** True when the newest Schwab account_value_points row is younger than maxAgeMs. */
export function schwabAccountValuesFresh(
  db: Database.Database,
  maxAgeMs = 120_000,
): boolean {
  const row = db
    .prepare(
      `
      SELECT MAX(av.as_of) AS maxAsOf
      FROM account_value_points av
      JOIN accounts a ON a.id = av.account_id
      WHERE a.id LIKE 'schwab_%'
    `,
    )
    .get() as { maxAsOf: string | null } | undefined;
  if (!row?.maxAsOf) return false;
  const ts = Date.parse(row.maxAsOf);
  return Number.isFinite(ts) && Date.now() - ts < maxAgeMs;
}

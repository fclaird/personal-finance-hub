import type Database from "better-sqlite3";

import { notPosterityWhereSql } from "@/lib/posterity";

/** Distinct equity/fund tickers from latest Schwab snapshots (for ingest tagging). */
export function loadHeldEquitySymbols(db: Database.Database, limit = 500): string[] {
  const rows = db
    .prepare(
      `
      SELECT DISTINCT UPPER(TRIM(s.symbol)) AS symbol
      FROM positions p
      JOIN holding_snapshots hs ON hs.id = p.snapshot_id
      JOIN accounts a ON a.id = hs.account_id
      JOIN securities s ON s.id = p.security_id
      WHERE a.id LIKE 'schwab_%'
        AND ${notPosterityWhereSql("a")}
        AND s.security_type NOT IN ('cash', 'option')
        AND s.symbol IS NOT NULL
        AND TRIM(s.symbol) != ''
        AND p.quantity > 0
        AND hs.as_of = (
          SELECT MAX(hs2.as_of) FROM holding_snapshots hs2 WHERE hs2.account_id = a.id
        )
      ORDER BY symbol ASC
      LIMIT ?
    `,
    )
    .all(limit) as Array<{ symbol: string }>;
  return rows.map((r) => r.symbol).filter(Boolean);
}

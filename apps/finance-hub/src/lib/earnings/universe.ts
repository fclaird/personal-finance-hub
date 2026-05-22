import { getDb } from "@/lib/db";

/** Equity symbols from the most recent holdings snapshot(s), plus optional env watchlist. */
export function getEarningsSymbolUniverse(limit = 80): string[] {
  const db = getDb();
  const maxAsOf = db.prepare(`SELECT MAX(as_of) AS m FROM holding_snapshots`).get() as { m: string | null } | undefined;
  if (!maxAsOf?.m) {
    return mergeWithEnv([]);
  }

  const rows = db
    .prepare(
      `
      SELECT DISTINCT UPPER(TRIM(s.symbol)) AS sym
      FROM positions p
      JOIN holding_snapshots hs ON hs.id = p.snapshot_id
      JOIN securities s ON s.id = p.security_id
      WHERE hs.as_of = @as_of
        AND s.security_type = 'equity'
        AND s.symbol IS NOT NULL
        AND LENGTH(TRIM(s.symbol)) > 0
    `,
    )
    .all({ as_of: maxAsOf.m }) as Array<{ sym: string }>;

  const fromHoldings = rows.map((r) => r.sym).filter(Boolean);
  const sliced = fromHoldings.slice(0, limit);
  return mergeWithEnv(sliced);
}

function mergeWithEnv(symbols: string[]): string[] {
  const extra = (process.env.EARNINGS_WATCHLIST ?? "")
    .split(/[,\s]+/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  const set = new Set<string>([...symbols, ...extra]);
  return Array.from(set);
}

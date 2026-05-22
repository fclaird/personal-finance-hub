import { getDb } from "@/lib/db";
import type { DataMode } from "@/lib/dataMode";
import { notPosterityWhereSql } from "@/lib/posterity";

function normSym(s: string) {
  return (s ?? "").trim().toUpperCase();
}

export type TerminalUniverseParams = {
  mode?: DataMode;
  includeWatchlistId?: string | null;
};

/**
 * Portfolio-aware default universe:
 * - spot symbols from latest snapshots per account
 * - option underlyings from latest snapshots per account
 * - excludes cash and null symbols
 * Optional overlay: symbols from a watchlist.
 */
export function getTerminalUniverseSymbols(params: TerminalUniverseParams = {}): string[] {
  const db = getDb();
  const mode = params.mode ?? "auto";
  const where =
    mode === "schwab"
      ? `a.id LIKE 'schwab_%' AND ${notPosterityWhereSql("a")}`
      : `a.id NOT LIKE 'demo_%' AND ${notPosterityWhereSql("a")}`;

  const snaps = db
    .prepare(
      `
      SELECT hs.id AS snapshot_id
      FROM accounts a
      JOIN holding_snapshots hs ON hs.account_id = a.id
      WHERE ${where}
        AND hs.as_of = (
          SELECT MAX(hs2.as_of) FROM holding_snapshots hs2 WHERE hs2.account_id = a.id
        )
    `,
    )
    .all() as Array<{ snapshot_id: string }>;
  const snapshotIds = snaps.map((r) => r.snapshot_id);

  const out = new Set<string>();
  if (snapshotIds.length) {
    const rows = db
      .prepare(
        `
        SELECT DISTINCT
          CASE
            WHEN s.security_type = 'option' THEN COALESCE(us.symbol, s.symbol)
            ELSE s.symbol
          END AS sym
        FROM positions p
        JOIN securities s ON s.id = p.security_id
        LEFT JOIN securities us ON us.id = s.underlying_security_id
        WHERE p.snapshot_id IN (SELECT value FROM json_each(@snaps))
          AND s.security_type != 'cash'
          AND sym IS NOT NULL
      `,
      )
      .all({ snaps: JSON.stringify(snapshotIds) }) as Array<{ sym: string | null }>;

    for (const r of rows) {
      const s = normSym(r.sym ?? "");
      if (!s || s === "CASH") continue;
      out.add(s);
    }
  }

  const watchlistId = (params.includeWatchlistId ?? "").trim();
  if (watchlistId) {
    const wl = db
      .prepare(
        `
        SELECT symbol
        FROM watchlist_items
        WHERE watchlist_id = ?
      `,
      )
      .all(watchlistId) as Array<{ symbol: string }>;
    for (const r of wl) {
      const s = normSym(r.symbol ?? "");
      if (!s) continue;
      out.add(s);
    }
  }

  return Array.from(out.values()).sort((a, b) => a.localeCompare(b));
}


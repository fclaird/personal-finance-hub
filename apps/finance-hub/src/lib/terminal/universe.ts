import { getDb } from "@/lib/db";
import type { DataMode } from "@/lib/dataMode";
import { latestSnapshotIds } from "@/lib/holdings/latestSnapshots";

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

  const scope = mode === "schwab" ? "schwab_only" : "all_synced";
  const snapshotIds = latestSnapshotIds(db, scope);
  if (snapshotIds.length === 0) return [];

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

  const out = new Set<string>();
  for (const r of rows) {
      const s = normSym(r.sym ?? "");
    if (!s || s === "CASH") continue;
    out.add(s);
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


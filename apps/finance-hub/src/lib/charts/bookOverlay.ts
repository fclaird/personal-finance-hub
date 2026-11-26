import type Database from "better-sqlite3";

import { accountsInViewWhereSql, latestSnapshotPerAccountJoinSql } from "@/lib/holdings/latestSnapshots";
import type { DataMode } from "@/lib/dataMode";
import type { FlavorId } from "@/lib/flavor";
import { normalizeOptionUnderlying } from "@/lib/options/optionUnderlying";

export type BookStrike = {
  strike: number;
  rights: Array<"C" | "P">;
  quantity: number;
};

export type BookOverlay = {
  symbol: string;
  strikes: BookStrike[];
  expiries: string[];
};

type OptionRow = {
  symbol: string | null;
  name: string | null;
  underlying: string | null;
  strike: number | null;
  expiration: string | null;
  right: string | null;
  quantity: number;
};

function rightOf(row: OptionRow): "C" | "P" | null {
  const raw = (row.right ?? "").trim().toUpperCase();
  if (raw === "C" || raw === "CALL") return "C";
  if (raw === "P" || raw === "PUT") return "P";
  const source = `${row.symbol ?? ""} ${row.name ?? ""}`;
  const occ = source.match(/(\d{6})([CP])(\d{8})/);
  if (occ) return occ[2] as "C" | "P";
  const named = source.match(/\b([CP])\b/);
  return named ? (named[1] as "C" | "P") : null;
}

function strikeOf(row: OptionRow): number | null {
  if (row.strike != null && Number.isFinite(row.strike) && row.strike > 0) return row.strike;
  const source = `${row.symbol ?? ""} ${row.name ?? ""}`;
  const occ = source.match(/(\d{6})([CP])(\d{8})/);
  if (occ) return Number(occ[3]) / 1000;
  const named = source.match(/([CP])\s+([0-9]+(?:\.[0-9]+)?)/);
  if (named) return Number(named[2]);
  return null;
}

function expirationOf(row: OptionRow): string | null {
  if (row.expiration && /^\d{4}-\d{2}-\d{2}$/.test(row.expiration)) return row.expiration;
  const source = row.symbol ?? "";
  const occ = source.replace(/\s+/g, " ").match(/(\d{2})(\d{2})(\d{2})[CP]\d{8}/);
  if (!occ) {
    const named = (row.name ?? "").match(/(\d{4}-\d{2}-\d{2})/);
    return named ? named[1]! : null;
  }
  return `20${occ[1]}-${occ[2]}-${occ[3]}`;
}

export function bookOverlayFromRows(symbol: string, rows: readonly OptionRow[]): BookOverlay {
  const target = symbol.trim().toUpperCase();
  const byStrike = new Map<number, BookStrike>();
  const expiries = new Set<string>();
  for (const row of rows) {
    const underlying = normalizeOptionUnderlying(row.underlying, row.symbol);
    if (underlying !== target) continue;
    const strike = strikeOf(row);
    const right = rightOf(row);
    const expiration = expirationOf(row);
    if (strike == null || !right) continue;
    if (expiration) expiries.add(expiration);
    const key = Math.round(strike * 1000) / 1000;
    const existing = byStrike.get(key);
    if (!existing) {
      byStrike.set(key, { strike: key, rights: [right], quantity: row.quantity });
      continue;
    }
    if (!existing.rights.includes(right)) existing.rights.push(right);
    existing.quantity += row.quantity;
  }
  return {
    symbol: target,
    strikes: [...byStrike.values()].sort((a, b) => a.strike - b.strike),
    expiries: [...expiries].sort(),
  };
}

export function loadBookOverlay(
  db: Database.Database,
  symbol: string,
  flavor: FlavorId,
  mode: DataMode,
): BookOverlay {
  const rows = db
    .prepare(
      `SELECT s.symbol AS symbol, s.name AS name, us.symbol AS underlying,
              s.strike_price AS strike, s.expiration_date AS expiration,
              s.option_type AS right, p.quantity AS quantity
       FROM positions p
       JOIN holding_snapshots hs ON hs.id = p.snapshot_id
       JOIN accounts a ON a.id = hs.account_id
       JOIN securities s ON s.id = p.security_id
       LEFT JOIN securities us ON us.id = s.underlying_security_id
       ${latestSnapshotPerAccountJoinSql("hs")}
       WHERE s.security_type = 'option' AND ${accountsInViewWhereSql(flavor, mode, "a")}`,
    )
    .all() as OptionRow[];
  return bookOverlayFromRows(symbol, rows);
}

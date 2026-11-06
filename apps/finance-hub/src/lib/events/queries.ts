import type Database from "better-sqlite3";

import type { ExDividendInput, EarningsInput, OpenOption } from "@/lib/events/eventCalendar";
import { resolvePositionAveragePrice } from "@/lib/holdings/positionAveragePrice";
import type { PnlPosition } from "@/lib/alerts/watchAlerts";

function norm(symbol: string): string {
  return symbol.trim().toUpperCase();
}

function placeholders(n: number): string {
  return Array.from({ length: n }, () => "?").join(", ");
}

export function heldSymbols(db: Database.Database, snapshotIds: readonly string[]): string[] {
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
      WHERE p.snapshot_id IN (${placeholders(snapshotIds.length)})
        AND s.security_type != 'cash'
        AND sym IS NOT NULL
    `,
    )
    .all(...snapshotIds) as Array<{ sym: string | null }>;
  return [...new Set(rows.map((row) => norm(row.sym ?? "")).filter((symbol) => symbol && symbol !== "CASH"))].sort();
}

export function openOptions(db: Database.Database, snapshotIds: readonly string[]): OpenOption[] {
  if (snapshotIds.length === 0) return [];
  const rows = db
    .prepare(
      `
      SELECT
        p.id AS positionId,
        COALESCE(us.symbol, s.symbol) AS underlying,
        s.expiration_date AS expiry,
        COALESCE(s.symbol, '') AS label
      FROM positions p
      JOIN securities s ON s.id = p.security_id
      LEFT JOIN securities us ON us.id = s.underlying_security_id
      WHERE p.snapshot_id IN (${placeholders(snapshotIds.length)})
        AND s.security_type = 'option'
        AND s.expiration_date IS NOT NULL
        AND p.quantity != 0
    `,
    )
    .all(...snapshotIds) as Array<{ positionId: string; underlying: string | null; expiry: string; label: string }>;
  return rows.flatMap((row) => {
    const underlying = norm(row.underlying ?? "");
    const expiry = row.expiry.slice(0, 10);
    if (!underlying || !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) return [];
    return [{ positionId: row.positionId, underlying, expiry, label: row.label || underlying }];
  });
}

export function earningsForSymbols(
  db: Database.Database,
  symbols: readonly string[],
  from: string,
  to: string,
): EarningsInput[] {
  const list = [...new Set(symbols.map(norm).filter(Boolean))];
  if (list.length === 0) return [];
  const rows = db
    .prepare(
      `
      SELECT UPPER(symbol) AS symbol, earnings_date AS date, time_of_day AS timeOfDay, source
      FROM earnings_events
      WHERE earnings_date >= ? AND earnings_date <= ?
        AND UPPER(symbol) IN (${placeholders(list.length)})
      ORDER BY earnings_date ASC, symbol ASC
    `,
    )
    .all(from, to, ...list) as EarningsInput[];
  return rows;
}

export function exDividendsForSymbols(
  db: Database.Database,
  symbols: readonly string[],
  from: string,
  to: string,
): ExDividendInput[] {
  const list = [...new Set(symbols.map(norm).filter(Boolean))];
  if (list.length === 0) return [];
  const marks = placeholders(list.length);
  const fromCash = db
    .prepare(
      `
      SELECT UPPER(s.symbol) AS symbol, substr(cf.ex_date, 1, 10) AS date
      FROM cashflows cf
      JOIN securities s ON s.id = cf.security_id
      WHERE cf.ex_date IS NOT NULL
        AND substr(cf.ex_date, 1, 10) >= ?
        AND substr(cf.ex_date, 1, 10) <= ?
        AND UPPER(s.symbol) IN (${marks})
    `,
    )
    .all(from, to, ...list) as Array<{ symbol: string; date: string }>;
  const fromSnap = db
    .prepare(
      `
      SELECT UPPER(symbol) AS symbol, substr(next_ex_date, 1, 10) AS date
      FROM dividend_model_symbol_fundamentals_snap
      WHERE next_ex_date IS NOT NULL
        AND substr(next_ex_date, 1, 10) >= ?
        AND substr(next_ex_date, 1, 10) <= ?
        AND UPPER(symbol) IN (${marks})
    `,
    )
    .all(from, to, ...list) as Array<{ symbol: string; date: string }>;
  const out: ExDividendInput[] = [];
  const seen = new Set<string>();
  for (const row of fromCash) {
    const key = `${row.symbol}|${row.date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ symbol: row.symbol, date: row.date, source: "cashflows" });
  }
  for (const row of fromSnap) {
    const key = `${row.symbol}|${row.date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ symbol: row.symbol, date: row.date, source: "dividend fundamentals" });
  }
  return out;
}

export function watchlistSymbols(db: Database.Database, watchlistId: string): string[] {
  const id = watchlistId.trim();
  if (!id) return [];
  const rows = db.prepare(`SELECT symbol FROM watchlist_items WHERE watchlist_id = ?`).all(id) as Array<{ symbol: string }>;
  return [...new Set(rows.map((row) => norm(row.symbol)).filter(Boolean))].sort();
}

export function latestIvRank(db: Database.Database, symbols: readonly string[]): Map<string, number> {
  const list = [...new Set(symbols.map(norm).filter(Boolean))];
  const out = new Map<string, number>();
  if (list.length === 0) return out;
  const rows = db
    .prepare(
      `
      SELECT UPPER(e.symbol) AS symbol, m.iv_rank_pct AS ivRankPct
      FROM earnings_opp_metrics m
      JOIN earnings_events e ON e.id = m.earnings_event_id
      WHERE m.iv_rank_pct IS NOT NULL
        AND UPPER(e.symbol) IN (${placeholders(list.length)})
      ORDER BY m.updated_at DESC
    `,
    )
    .all(...list) as Array<{ symbol: string; ivRankPct: number }>;
  for (const row of rows) {
    if (!out.has(row.symbol) && Number.isFinite(row.ivRankPct)) out.set(row.symbol, row.ivRankPct);
  }
  return out;
}

export function pnlPositions(db: Database.Database, snapshotIds: readonly string[], quotes: ReadonlyMap<string, number | null>): PnlPosition[] {
  if (snapshotIds.length === 0) return [];
  const rows = db
    .prepare(
      `
      SELECT
        CASE
          WHEN s.security_type = 'option' THEN COALESCE(us.symbol, s.symbol)
          ELSE s.symbol
        END AS underlying,
        s.security_type AS securityType,
        p.quantity AS quantity,
        p.price AS price,
        p.market_value AS marketValue,
        p.metadata_json AS metadataJson
      FROM positions p
      JOIN securities s ON s.id = p.security_id
      LEFT JOIN securities us ON us.id = s.underlying_security_id
      WHERE p.snapshot_id IN (${placeholders(snapshotIds.length)})
        AND s.security_type != 'cash'
        AND p.quantity != 0
    `,
    )
    .all(...snapshotIds) as Array<{
    underlying: string | null;
    securityType: string;
    quantity: number;
    price: number | null;
    marketValue: number | null;
    metadataJson: string | null;
  }>;
  return rows.flatMap((row) => {
    const underlying = norm(row.underlying ?? "");
    if (!underlying) return [];
    return [
      {
        underlying,
        securityType: row.securityType,
        quantity: row.quantity,
        averagePrice: resolvePositionAveragePrice(row.price, row.metadataJson),
        marketValue: row.marketValue,
        quote: quotes.get(underlying) ?? null,
      },
    ];
  });
}

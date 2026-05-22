import type Database from "better-sqlite3";

export type SchwabSlicePosition = {
  symbol: string;
  quantity: number | null;
  avgUnitCost: number | null;
  marketValue: number | null;
  securityName: string | null;
  /** True when this symbol was requested but no equity row exists in the latest snapshot. */
  missing: boolean;
};

export function latestSnapshotIdForAccount(db: Database.Database, accountId: string): string | null {
  const row = db
    .prepare(
      `
      SELECT hs.id AS id
      FROM holding_snapshots hs
      WHERE hs.account_id = ?
      ORDER BY hs.as_of DESC
      LIMIT 1
    `,
    )
    .get(accountId) as { id: string } | undefined;
  return row?.id ?? null;
}

export function latestSnapshotAsOfForAccount(db: Database.Database, accountId: string): string | null {
  const row = db
    .prepare(
      `
      SELECT hs.as_of AS asOf
      FROM holding_snapshots hs
      WHERE hs.account_id = ?
      ORDER BY hs.as_of DESC
      LIMIT 1
    `,
    )
    .get(accountId) as { asOf: string } | undefined;
  return row?.asOf ?? null;
}

/**
 * Latest Schwab positions for `accountId` restricted to requested symbols (dividend model ticker list).
 */
export function resolveSchwabSlice(
  db: Database.Database,
  accountId: string,
  symbols: string[],
): { snapshotId: string | null; asOf: string | null; positions: SchwabSlicePosition[] } {
  const uniq = Array.from(new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean)));
  const snapshotId = latestSnapshotIdForAccount(db, accountId);
  const asOf = latestSnapshotAsOfForAccount(db, accountId);
  if (!snapshotId || uniq.length === 0) {
    return {
      snapshotId,
      asOf,
      positions: uniq.map((symbol) => ({
        symbol,
        quantity: null,
        avgUnitCost: null,
        marketValue: null,
        securityName: null,
        missing: true,
      })),
    };
  }

  const ph = uniq.map(() => "?").join(",");
  const rows = db
    .prepare(
      `
      SELECT UPPER(s.symbol) AS symbol, p.quantity AS quantity, p.price AS price, p.market_value AS marketValue, s.name AS securityName
      FROM positions p
      JOIN securities s ON s.id = p.security_id
      WHERE p.snapshot_id = ?
        AND UPPER(s.symbol) IN (${ph})
        AND s.security_type != 'cash'
    `,
    )
    .all(snapshotId, ...uniq) as Array<{
    symbol: string;
    quantity: number;
    price: number | null;
    marketValue: number | null;
    securityName: string | null;
  }>;

  const bySym = new Map<string, (typeof rows)[0]>();
  for (const r of rows) {
    if (!bySym.has(r.symbol)) bySym.set(r.symbol, r);
  }

  const positions: SchwabSlicePosition[] = uniq.map((symbol) => {
    const r = bySym.get(symbol);
    if (!r) {
      return { symbol, quantity: null, avgUnitCost: null, marketValue: null, securityName: null, missing: true };
    }
    const qty = typeof r.quantity === "number" && Number.isFinite(r.quantity) ? r.quantity : null;
    const avg =
      r.price != null && Number.isFinite(r.price) && r.price > 0
        ? r.price
        : qty != null && qty !== 0 && r.marketValue != null && Number.isFinite(r.marketValue) && r.marketValue > 0
          ? r.marketValue / qty
          : null;
    const mv = r.marketValue != null && Number.isFinite(r.marketValue) ? r.marketValue : null;
    return {
      symbol,
      quantity: qty,
      avgUnitCost: avg,
      marketValue: mv,
      securityName: r.securityName?.trim() ? r.securityName.trim() : null,
      missing: false,
    };
  });

  return { snapshotId, asOf, positions };
}

export function sliceTotals(positions: SchwabSlicePosition[]): {
  totalMarketValue: number;
  totalCostBasis: number;
  matchedSymbols: number;
} {
  let totalMarketValue = 0;
  let totalCostBasis = 0;
  let matchedSymbols = 0;
  for (const p of positions) {
    if (p.missing) continue;
    matchedSymbols += 1;
    if (p.marketValue != null && Number.isFinite(p.marketValue)) totalMarketValue += p.marketValue;
    if (p.quantity != null && p.avgUnitCost != null && Number.isFinite(p.quantity) && Number.isFinite(p.avgUnitCost)) {
      totalCostBasis += p.quantity * p.avgUnitCost;
    }
  }
  return { totalMarketValue, totalCostBasis, matchedSymbols };
}

/** Sum dividend cashflows paid in [payStartIso, payEndIso] for account + symbol list. */
export function sumAccountDividendsForSymbolsPayWindow(
  db: Database.Database,
  accountId: string,
  symbols: string[],
  payStartIso: string,
  payEndIso: string,
  projectedOnly = false,
): number {
  const uniq = Array.from(new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean)));
  if (uniq.length === 0) return 0;
  const ph = uniq.map(() => "?").join(",");
  const typeSql = projectedOnly ? `AND cf.type = 'dividend_projected'` : `AND cf.type IN ('dividend_actual', 'dividend_projected')`;
  const row = db
    .prepare(
      `
      SELECT COALESCE(SUM(cf.amount), 0) AS total
      FROM cashflows cf
      INNER JOIN securities s ON s.id = cf.security_id
      WHERE cf.account_id = ?
        AND UPPER(s.symbol) IN (${ph})
        ${typeSql}
        AND substr(cf.pay_date, 1, 10) >= ?
        AND substr(cf.pay_date, 1, 10) <= ?
    `,
    )
    .get(accountId, ...uniq, payStartIso, payEndIso) as { total: number } | undefined;
  return typeof row?.total === "number" && Number.isFinite(row.total) ? row.total : 0;
}

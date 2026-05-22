import type Database from "better-sqlite3";

import type { EnrichedHoldingRow } from "./enrichedHoldings";

/** True when symbol has stored dividend history or positive yield estimates. */
export function symbolIsDividendProducer(db: Database.Database, symbol: string): boolean {
  const sym = symbol.trim().toUpperCase();
  if (!sym) return false;

  const pay = db
    .prepare(`SELECT 1 FROM symbol_dividend_payments WHERE symbol = ? COLLATE NOCASE LIMIT 1`)
    .get(sym);
  if (pay) return true;

  const monthly = db
    .prepare(
      `SELECT 1 FROM symbol_monthly_market WHERE symbol = ? COLLATE NOCASE AND dividend_per_share > 0 LIMIT 1`,
    )
    .get(sym);
  if (monthly) return true;

  const snap = db
    .prepare(
      `
      SELECT div_yield AS divYield, annual_div_est AS annualDivEst
      FROM dividend_model_symbol_fundamentals_snap
      WHERE symbol = ? COLLATE NOCASE
      ORDER BY captured_at DESC
      LIMIT 1
    `,
    )
    .get(sym) as { divYield: number | null; annualDivEst: number | null } | undefined;

  if (snap?.divYield != null && Number.isFinite(snap.divYield) && snap.divYield > 0) return true;
  if (snap?.annualDivEst != null && Number.isFinite(snap.annualDivEst) && snap.annualDivEst > 0) return true;

  return false;
}

export function holdingRowIsDividendProducer(db: Database.Database, row: EnrichedHoldingRow): boolean {
  if (row.divYield != null && Number.isFinite(row.divYield) && row.divYield > 0) return true;
  if (row.annualDivEst != null && Number.isFinite(row.annualDivEst) && row.annualDivEst > 0) return true;
  return symbolIsDividendProducer(db, row.symbol);
}

export function filterDividendProducingHoldings(
  db: Database.Database,
  rows: EnrichedHoldingRow[],
): EnrichedHoldingRow[] {
  return rows.filter((r) => holdingRowIsDividendProducer(db, r));
}

/** Holding qualifies for the Dividends tab: positive shares and dividend-producing symbol. */
export function holdingQualifiesForDividendsTab(
  db: Database.Database,
  symbol: string,
  shares: number | null,
  enriched?: Pick<EnrichedHoldingRow, "divYield" | "annualDivEst">,
): boolean {
  if (shares == null || !Number.isFinite(shares) || shares <= 0) return false;
  if (enriched) {
    if (enriched.divYield != null && Number.isFinite(enriched.divYield) && enriched.divYield > 0) return true;
    if (enriched.annualDivEst != null && Number.isFinite(enriched.annualDivEst) && enriched.annualDivEst > 0) return true;
  }
  return symbolIsDividendProducer(db, symbol);
}

export function countDividendHoldingsInPortfolio(db: Database.Database, portfolioId: string): number {
  const holdings = db
    .prepare(`SELECT symbol, shares FROM dividend_model_holdings WHERE portfolio_id = ?`)
    .all(portfolioId) as Array<{ symbol: string; shares: number | null }>;

  let n = 0;
  for (const h of holdings) {
    if (holdingQualifiesForDividendsTab(db, h.symbol, h.shares)) n += 1;
  }
  return n;
}

import type Database from "better-sqlite3";

import type { DividendCashRow } from "./dashboardMetrics";

/** Portfolio-level dividend cash rows from symbol_monthly_market × manual shares. */
export function fetchSimulatedDividendsForPortfolio(
  db: Database.Database,
  portfolioId: string,
): DividendCashRow[] {
  const rows = db
    .prepare(
      `
      SELECT
        UPPER(h.symbol) AS symbol,
        substr(ms.month_end, 1, 10) AS payDay,
        ms.month_dividends AS amount
      FROM dividend_model_portfolio_monthly_symbol ms
      INNER JOIN dividend_model_holdings h
        ON h.portfolio_id = ms.portfolio_id AND h.symbol = ms.symbol
      WHERE ms.portfolio_id = ?
        AND ms.month_dividends > 0
      ORDER BY payDay ASC, symbol ASC
    `,
    )
    .all(portfolioId) as DividendCashRow[];
  return rows;
}

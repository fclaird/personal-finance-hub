import type Database from "better-sqlite3";

import { monthEndForDate, monthEndsBetweenInclusive } from "./dates";
import { persistPortfolioSimulation } from "./portfolioSimulation";
import { readSymbolMonthlyFacts } from "./symbolMonthlyMarket";

export function materializePortfolioMonthlyHistory(
  db: Database.Database,
  portfolioId: string,
  holdings: Array<{ id: string; symbol: string; shares: number | null }>,
): { monthlyRows: number; simRows: number } {
  const now = new Date();
  const endMonth = monthEndForDate(now);
  const startAnchor = new Date(Date.UTC(now.getUTCFullYear() - 5, now.getUTCMonth(), 1));
  const startMonth = monthEndForDate(startAnchor);
  const months = monthEndsBetweenInclusive(startMonth, endMonth);
  const computedAt = now.toISOString();

  db.prepare(`DELETE FROM dividend_model_portfolio_monthly_symbol WHERE portfolio_id = ?`).run(portfolioId);

  const insMs = db.prepare(
    `
    INSERT INTO dividend_model_portfolio_monthly_symbol
      (portfolio_id, symbol, month_end, month_dividends, market_value_eom, close_eom, shares_used, annualized_yield_pct)
    VALUES (@portfolio_id, @symbol, @month_end, @month_dividends, @market_value_eom, @close_eom, @shares_used, @annualized_yield_pct)
  `,
  );

  let monthlyRows = 0;
  const writeSymbolMonths = db.transaction(() => {
    for (const h of holdings) {
      const sh = h.shares as number;
      const sym = h.symbol.toUpperCase();
      for (const me of months) {
        const factsRow = readSymbolMonthlyFacts(db, sym, me);
        if (!factsRow) continue;
        const close = factsRow.close_eom;
        if (close == null || !Number.isFinite(close)) continue;
        const monthDiv = (factsRow.dividend_per_share ?? 0) * sh;
        insMs.run({
          portfolio_id: portfolioId,
          symbol: h.symbol,
          month_end: me,
          month_dividends: monthDiv,
          market_value_eom: close * sh,
          close_eom: close,
          shares_used: sh,
          annualized_yield_pct: factsRow.annualized_yield_pct,
        });
        monthlyRows += 1;
      }
    }
  });
  writeSymbolMonths();

  const simHoldings = holdings.map((h) => ({ symbol: h.symbol.toUpperCase(), shares: h.shares as number }));
  const simRows = persistPortfolioSimulation(db, portfolioId, months, simHoldings, endMonth, computedAt);

  return { monthlyRows, simRows };
}

import type Database from "better-sqlite3";

import { getDb } from "@/lib/db";

import { fridayOfUtcWeekContaining } from "./dates";
import { refreshPortfolioFundamentals } from "./refreshFundamentals";

export type RefreshDividendModelPortfolioResult = {
  ok: true;
  symbols: number;
  monthlyRows: number;
  simRows: number;
  symbolFactsRows: number;
  message?: string;
};

/** Full portfolio history rebuild (alias for refresh fundamentals without fundamentalsOnly). */
export async function refreshDividendModelPortfolio(
  portfolioId: string,
  db: Database.Database = getDb(),
): Promise<RefreshDividendModelPortfolioResult> {
  const r = await refreshPortfolioFundamentals(portfolioId, db);
  return {
    ok: true,
    symbols: r.symbols,
    monthlyRows: r.monthlyRows,
    simRows: r.simRows,
    symbolFactsRows: r.symbolFactsRows,
    message: r.message,
  };
}

/** Finalize modeled months (cron-safe). */
export function finalizeDividendModelRollups(db: Database.Database = getDb()): {
  monthlyFinalized: number;
  forwardFinalized: number;
} {
  const now = new Date();
  const firstThisMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;

  const r1 = db
    .prepare(
      `
      UPDATE dividend_model_portfolio_sim_monthly
      SET status = 'final'
      WHERE month_end < ? AND status = 'partial'
    `,
    )
    .run(firstThisMonth);

  const thisFriday = fridayOfUtcWeekContaining(now);
  const r2 = db
    .prepare(
      `
      UPDATE dividend_model_portfolio_forward_snap
      SET status = 'final'
      WHERE status = 'partial' AND as_of < ?
    `,
    )
    .run(thisFriday);

  return { monthlyFinalized: r1.changes, forwardFinalized: r2.changes };
}

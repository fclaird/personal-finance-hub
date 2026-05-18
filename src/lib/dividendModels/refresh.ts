import type Database from "better-sqlite3";

import { getDb } from "@/lib/db";
import { logError } from "@/lib/log";
import { newId } from "@/lib/id";

import { monthEndForDate, monthEndsBetweenInclusive, fridayOfUtcWeekContaining } from "./dates";
import { fetchMergedDividendFundamentals } from "./mergedFundamentals";
import { persistPortfolioSimulation } from "./portfolioSimulation";
import { readSymbolMonthlyFacts, backfillSymbolMonthlyMarket } from "./symbolMonthlyMarket";

export type RefreshDividendModelPortfolioResult = {
  ok: true;
  symbols: number;
  monthlyRows: number;
  simRows: number;
  symbolFactsRows: number;
  message?: string;
};

async function captureFundamentals(db: Database.Database, symbols: string[]): Promise<void> {
  const now = new Date().toISOString();
  const ins = db.prepare(
    `
    INSERT INTO dividend_model_symbol_fundamentals_snap (id, symbol, captured_at, div_yield, annual_div_est, next_ex_date, raw_json, source)
    VALUES (@id, @symbol, @captured_at, @div_yield, @annual_div_est, @next_ex_date, @raw_json, @source)
  `,
  );

  for (const sym of symbols) {
    try {
      const m = await fetchMergedDividendFundamentals(sym);
      ins.run({
        id: newId("dmfs"),
        symbol: sym,
        captured_at: now,
        div_yield: m.divYield,
        annual_div_est: m.annualDivEst,
        next_ex_date: m.nextExDate,
        raw_json: JSON.stringify(m.raw ?? {}),
        source: m.source,
      });
    } catch (e) {
      logError(`dividend_model_fundamental_${sym}`, e);
    }
  }
}

export async function refreshDividendModelPortfolio(
  portfolioId: string,
  db: Database.Database = getDb(),
): Promise<RefreshDividendModelPortfolioResult> {
  const holdings = db
    .prepare(
      `SELECT id, symbol, shares FROM dividend_model_holdings WHERE portfolio_id = ? ORDER BY sort_order ASC, symbol ASC`,
    )
    .all(portfolioId) as Array<{ id: string; symbol: string; shares: number | null }>;

  const symbols = holdings.map((h) => h.symbol.toUpperCase());
  if (symbols.length === 0) {
    return { ok: true, symbols: 0, monthlyRows: 0, simRows: 0, symbolFactsRows: 0, message: "No holdings" };
  }

  const anyMissingShares = holdings.some((h) => h.shares == null || !Number.isFinite(h.shares) || h.shares <= 0);
  if (anyMissingShares) {
    return {
      ok: true,
      symbols: symbols.length,
      monthlyRows: 0,
      simRows: 0,
      symbolFactsRows: 0,
      message: "Set finite share counts on every holding before building history",
    };
  }

  await captureFundamentals(db, symbols);
  const facts = await backfillSymbolMonthlyMarket(db, symbols);

  const now = new Date();
  const endMonth = monthEndForDate(now);
  const startAnchor = new Date(Date.UTC(now.getUTCFullYear() - 5, now.getUTCMonth(), 1));
  const startMonth = monthEndForDate(startAnchor);
  const months = monthEndsBetweenInclusive(startMonth, endMonth);
  const computedAt = now.toISOString();

  const delMonthlySym = db.prepare(`DELETE FROM dividend_model_portfolio_monthly_symbol WHERE portfolio_id = ?`);
  delMonthlySym.run(portfolioId);

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

  return {
    ok: true,
    symbols: symbols.length,
    monthlyRows,
    simRows,
    symbolFactsRows: facts.rowsUpserted,
  };
}

/** Finalize modeled months (cron-safe). */
export function finalizeDividendModelRollups(db: Database.Database = getDb()): { monthlyFinalized: number; forwardFinalized: number } {
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

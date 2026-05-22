import type Database from "better-sqlite3";

import { closeOnOrBeforeIsoDate } from "./prices";
import { readSymbolMonthlyFacts } from "./symbolMonthlyMarket";

export type DripHolding = { symbol: string; shares: number };

export type DripLedgerRow = {
  symbol: string;
  pay_date: string;
  amount_per_share: number;
  dividend_cash: number;
  reinvest_price: number;
  shares_added: number;
  shares_after: number;
};

export type DripSimulationMonthPoint = {
  month_end: string;
  nav_total: number | null;
  total_dividends: number;
  portfolio_rebased_pct: number | null;
  price_only_rebased_pct: number | null;
  status: string;
};

export type DripSimulationResult = {
  points: DripSimulationMonthPoint[];
  ledger: DripLedgerRow[];
};

export type DripPayment = { symbol: string; payDate: string; amount: number };

/**
 * Pure DRIP simulator (testable). Each dividend payment buys
 * `dividend_cash / pay-date close` fractional shares, then NAV at each month-end
 * is `DRIP-adjusted shares × month-end close`.
 */
export function simulatePortfolioDripFromFacts(
  holdings: DripHolding[],
  payments: DripPayment[],
  monthEnds: string[],
  payDateClose: (symbol: string, payDate: string) => number | null,
  monthEndClose: (symbol: string, monthEnd: string) => number | null,
  endMonth: string,
): DripSimulationResult {
  const frozen: Record<string, number> = {};
  const live: Record<string, number> = {};
  for (const h of holdings) {
    if (!Number.isFinite(h.shares) || h.shares <= 0) continue;
    const sym = h.symbol.toUpperCase();
    frozen[sym] = h.shares;
    live[sym] = h.shares;
  }
  const syms = Object.keys(live);
  if (syms.length === 0 || monthEnds.length === 0) {
    return { points: [], ledger: [] };
  }

  const sortedPayments = payments
    .filter((p) => Number.isFinite(p.amount) && p.amount > 0 && live[p.symbol.toUpperCase()] != null)
    .map((p) => ({ symbol: p.symbol.toUpperCase(), payDate: p.payDate.slice(0, 10), amount: p.amount }))
    .sort((a, b) => (a.payDate < b.payDate ? -1 : a.payDate > b.payDate ? 1 : 0));

  const ledger: DripLedgerRow[] = [];
  const points: DripSimulationMonthPoint[] = [];
  const dividendsByMonth = new Map<string, number>();
  let firstNav: number | null = null;
  let firstPriceOnlyNav: number | null = null;
  let pIdx = 0;

  for (const me of monthEnds) {
    while (pIdx < sortedPayments.length && sortedPayments[pIdx]!.payDate <= me) {
      const pay = sortedPayments[pIdx]!;
      const sharesBefore = live[pay.symbol] ?? 0;
      if (sharesBefore > 0) {
        const price = payDateClose(pay.symbol, pay.payDate);
        if (price != null && price > 0) {
          const cash = pay.amount * sharesBefore;
          const added = cash / price;
          const after = sharesBefore + added;
          live[pay.symbol] = after;
          ledger.push({
            symbol: pay.symbol,
            pay_date: pay.payDate,
            amount_per_share: pay.amount,
            dividend_cash: cash,
            reinvest_price: price,
            shares_added: added,
            shares_after: after,
          });
          dividendsByMonth.set(me, (dividendsByMonth.get(me) ?? 0) + cash);
        }
      }
      pIdx += 1;
    }

    let mv = 0;
    let priceOnlyMv = 0;
    for (const sym of syms) {
      const close = monthEndClose(sym, me);
      if (close == null || !Number.isFinite(close) || close <= 0) continue;
      mv += (live[sym] ?? 0) * close;
      priceOnlyMv += (frozen[sym] ?? 0) * close;
    }

    const nav = mv > 0 ? mv : null;
    if (firstNav == null && nav != null && nav > 0) firstNav = nav;
    if (firstPriceOnlyNav == null && priceOnlyMv > 0) firstPriceOnlyNav = priceOnlyMv;

    const rebased = firstNav != null && nav != null && firstNav > 0 ? ((nav / firstNav) - 1) * 100 : null;
    const priceOnlyRebased =
      firstPriceOnlyNav != null && priceOnlyMv > 0 ? ((priceOnlyMv / firstPriceOnlyNav) - 1) * 100 : null;
    const isCurrentMonth = me === endMonth;
    const status = nav == null ? "partial" : isCurrentMonth ? "partial" : "final";

    points.push({
      month_end: me,
      nav_total: nav,
      total_dividends: dividendsByMonth.get(me) ?? 0,
      portfolio_rebased_pct: rebased,
      price_only_rebased_pct: priceOnlyRebased,
      status,
    });
  }

  return { points, ledger };
}

/**
 * DB-bound DRIP simulation: loads payments and price lookups from SQLite
 * (`symbol_dividend_payments`, Schwab daily OHLCV, `symbol_monthly_market`).
 */
export function simulatePortfolioDrip(
  db: Database.Database,
  holdings: DripHolding[],
  monthEnds: string[],
  startMonthEnd: string,
  endMonth: string,
): DripSimulationResult {
  const symbols = holdings
    .filter((h) => Number.isFinite(h.shares) && h.shares > 0)
    .map((h) => h.symbol.toUpperCase());
  const payments: DripPayment[] = [];
  if (symbols.length > 0) {
    const stmt = db.prepare(
      `
      SELECT pay_date AS payDate, amount
      FROM symbol_dividend_payments
      WHERE symbol = ? AND pay_date >= ? AND pay_date <= ?
      ORDER BY pay_date ASC
    `,
    );
    for (const sym of symbols) {
      const rows = stmt.all(sym, startMonthEnd, endMonth) as Array<{ payDate: string; amount: number }>;
      for (const r of rows) {
        payments.push({ symbol: sym, payDate: r.payDate, amount: r.amount });
      }
    }
  }

  return simulatePortfolioDripFromFacts(
    holdings,
    payments,
    monthEnds,
    (sym, payDate) => closeOnOrBeforeIsoDate(sym, payDate),
    (sym, me) => readSymbolMonthlyFacts(db, sym, me)?.close_eom ?? null,
    endMonth,
  );
}

export function persistDripLedger(
  db: Database.Database,
  portfolioId: string,
  ledger: DripLedgerRow[],
  computedAt: string,
): number {
  const del = db.prepare(`DELETE FROM dividend_model_drip_ledger WHERE portfolio_id = ?`);
  del.run(portfolioId);
  if (ledger.length === 0) return 0;

  const ins = db.prepare(
    `
    INSERT OR REPLACE INTO dividend_model_drip_ledger
      (portfolio_id, symbol, pay_date, amount_per_share, dividend_cash, reinvest_price, shares_added, shares_after, computed_at)
    VALUES
      (@portfolio_id, @symbol, @pay_date, @amount_per_share, @dividend_cash, @reinvest_price, @shares_added, @shares_after, @computed_at)
  `,
  );
  const write = db.transaction(() => {
    for (const row of ledger) {
      ins.run({ portfolio_id: portfolioId, computed_at: computedAt, ...row });
    }
  });
  write();
  return ledger.length;
}

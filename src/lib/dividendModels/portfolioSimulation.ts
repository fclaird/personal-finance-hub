import type Database from "better-sqlite3";

import { persistDripLedger, simulatePortfolioDrip } from "./portfolioDripSimulation";
import { readSymbolMonthlyFacts } from "./symbolMonthlyMarket";
import type { SimulationMode } from "./types";

export type SimulationHolding = { symbol: string; shares: number };

export type SimulationMonthPoint = {
  month_end: string;
  nav_total: number | null;
  total_dividends: number;
  portfolio_rebased_pct: number | null;
  price_only_rebased_pct: number | null;
  status: string;
};

export type SymbolMonthFacts = { close_eom: number | null; dividend_per_share: number };

/** In-memory simulation (testable without SQLite). */
export function simulatePortfolioMonthlyFromFacts(
  holdings: SimulationHolding[],
  monthEnds: string[],
  lookupFacts: (symbol: string, monthEnd: string) => SymbolMonthFacts | null,
  mode: SimulationMode,
  endMonth: string,
): SimulationMonthPoint[] {
  const qty: Record<string, number> = {};
  const frozenQty: Record<string, number> = {};
  for (const h of holdings) {
    if (!Number.isFinite(h.shares) || h.shares <= 0) continue;
    const sym = h.symbol.toUpperCase();
    qty[sym] = h.shares;
    frozenQty[sym] = h.shares;
  }
  const syms = Object.keys(qty);
  if (syms.length === 0 || monthEnds.length === 0) return [];

  let cash = 0;
  const points: SimulationMonthPoint[] = [];
  let firstNav: number | null = null;
  let firstPriceOnlyNav: number | null = null;

  for (const me of monthEnds) {
    const px: Record<string, number> = {};
    let mv = 0;
    let priceOnlyMv = 0;
    let monthDiv = 0;

    for (const s of syms) {
      const facts = lookupFacts(s, me);
      const close = facts?.close_eom ?? null;
      if (close != null && Number.isFinite(close) && close > 0) {
        px[s] = close;
        mv += qty[s]! * close;
        priceOnlyMv += frozenQty[s]! * close;
      }
      const dpsVal = facts?.dividend_per_share ?? 0;
      if (dpsVal > 0) monthDiv += dpsVal * qty[s]!;
    }

    if (mode === "reinvest" && monthDiv > 0 && mv > 0) {
      for (const s of syms) {
        const p = px[s];
        if (p == null || p <= 0) continue;
        const w = (qty[s]! * p) / mv;
        qty[s]! += (monthDiv * w) / p;
      }
    } else if (mode === "withdraw") {
      cash += monthDiv;
    }

    let nav: number | null = null;
    let mv2 = 0;
    for (const s of syms) {
      const p = px[s];
      if (p == null) continue;
      mv2 += qty[s]! * p;
    }
    if (mv2 > 0 || (mode === "withdraw" && cash > 0)) {
      nav = mv2 + (mode === "withdraw" ? cash : 0);
    }

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
      total_dividends: monthDiv,
      portfolio_rebased_pct: rebased,
      price_only_rebased_pct: priceOnlyRebased,
      status,
    });
  }

  return points;
}

export function runPortfolioSimulation(
  db: Database.Database,
  holdings: SimulationHolding[],
  monthEnds: string[],
  mode: SimulationMode,
  endMonth: string,
): SimulationMonthPoint[] {
  return simulatePortfolioMonthlyFromFacts(holdings, monthEnds, (sym, me) => readSymbolMonthlyFacts(db, sym, me), mode, endMonth);
}

export function persistPortfolioSimulation(
  db: Database.Database,
  portfolioId: string,
  monthEnds: string[],
  holdings: SimulationHolding[],
  endMonth: string,
  computedAt: string,
): number {
  const del = db.prepare(`DELETE FROM dividend_model_portfolio_sim_monthly WHERE portfolio_id = ?`);
  del.run(portfolioId);

  const ins = db.prepare(
    `
    INSERT INTO dividend_model_portfolio_sim_monthly
      (portfolio_id, month_end, simulation_mode, nav_total, total_dividends, portfolio_rebased_pct, price_only_rebased_pct, status, computed_at)
    VALUES
      (@portfolio_id, @month_end, @simulation_mode, @nav_total, @total_dividends, @portfolio_rebased_pct, @price_only_rebased_pct, @status, @computed_at)
  `,
  );

  const startMonthEnd = monthEnds[0] ?? endMonth;
  const drip = simulatePortfolioDrip(db, holdings, monthEnds, startMonthEnd, endMonth);
  const withdrawPoints = runPortfolioSimulation(db, holdings, monthEnds, "withdraw", endMonth);

  let rows = 0;
  const write = db.transaction(() => {
    for (const p of withdrawPoints) {
      ins.run({
        portfolio_id: portfolioId,
        month_end: p.month_end,
        simulation_mode: "withdraw" satisfies SimulationMode,
        nav_total: p.nav_total,
        total_dividends: p.total_dividends,
        portfolio_rebased_pct: p.portfolio_rebased_pct,
        price_only_rebased_pct: p.price_only_rebased_pct,
        status: p.status,
        computed_at: computedAt,
      });
      rows += 1;
    }
    for (const p of drip.points) {
      ins.run({
        portfolio_id: portfolioId,
        month_end: p.month_end,
        simulation_mode: "reinvest" satisfies SimulationMode,
        nav_total: p.nav_total,
        total_dividends: p.total_dividends,
        portfolio_rebased_pct: p.portfolio_rebased_pct,
        price_only_rebased_pct: p.price_only_rebased_pct,
        status: p.status,
        computed_at: computedAt,
      });
      rows += 1;
    }
  });
  write();

  persistDripLedger(db, portfolioId, drip.ledger, computedAt);
  return rows;
}

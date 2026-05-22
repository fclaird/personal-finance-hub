import type Database from "better-sqlite3";

import { ensureBenchmarkHistory } from "@/lib/market/benchmarks";

import { monthEndForDate, monthEndsBetweenInclusive } from "./dates";
import { benchmarkCloseOnOrBefore } from "./prices";
import { simulatePortfolioDrip } from "./portfolioDripSimulation";
import { runPortfolioSimulation, type SimulationMonthPoint } from "./portfolioSimulation";
import { loadSyntheticHoldings } from "./syntheticHoldings";
import { anchorMonthEndForWindowYears } from "./symbolBacktestAnchor";
import type { SimulationMode, TimelineYears } from "./types";

export type ModeledTimelinePoint = {
  month_end: string;
  portfolio_rebased_pct: number | null;
  price_only_rebased_pct: number | null;
  total_market_value: number | null;
  total_dividends: number;
  spy_rebased_pct: number | null;
  qqq_rebased_pct: number | null;
  status: string;
};

export type ModeledTimelineResult = {
  points: ModeledTimelinePoint[];
  totalDividendsReceived: number;
  /** Set when synthetic holdings are missing for this window. */
  missingSynthetic?: boolean;
};

function simulateModeledPoints(
  db: Database.Database,
  holdings: Array<{ symbol: string; shares: number }>,
  monthEnds: string[],
  mode: SimulationMode,
  endMonth: string,
): SimulationMonthPoint[] {
  if (monthEnds.length === 0) return [];
  const startMonthEnd = monthEnds[0]!;
  if (mode === "reinvest") {
    return simulatePortfolioDrip(db, holdings, monthEnds, startMonthEnd, endMonth).points;
  }
  return runPortfolioSimulation(db, holdings, monthEnds, "withdraw", endMonth);
}

export async function buildModeledMonthlyTimeline(
  db: Database.Database,
  portfolioId: string,
  years: TimelineYears,
  mode: SimulationMode,
  includeSpy: boolean,
  includeQqq: boolean,
): Promise<ModeledTimelineResult> {
  const syntheticHoldings = loadSyntheticHoldings(db, portfolioId, years);
  if (syntheticHoldings.length === 0) {
    return { points: [], totalDividendsReceived: 0, missingSynthetic: true };
  }

  const now = new Date();
  const endMonth = monthEndForDate(now);
  const anchorMonthEnd = anchorMonthEndForWindowYears(now, years);
  const monthEnds = monthEndsBetweenInclusive(anchorMonthEnd, endMonth);
  if (monthEnds.length === 0) {
    return { points: [], totalDividendsReceived: 0, missingSynthetic: true };
  }

  const simPoints = simulateModeledPoints(db, syntheticHoldings, monthEnds, mode, endMonth);

  if (includeSpy) await ensureBenchmarkHistory("SPY");
  if (includeQqq) await ensureBenchmarkHistory("QQQ");

  const firstMe = simPoints[0]?.month_end ?? anchorMonthEnd;
  let spyBase: number | null = null;
  let qqqBase: number | null = null;
  if (includeSpy) spyBase = benchmarkCloseOnOrBefore("SPY", firstMe);
  if (includeQqq) qqqBase = benchmarkCloseOnOrBefore("QQQ", firstMe);

  let totalDividendsReceived = 0;
  const points = simPoints.map((r) => {
    totalDividendsReceived += Math.max(0, Number(r.total_dividends) || 0);

    let spyPct: number | null = null;
    let qqqPct: number | null = null;
    if (includeSpy && spyBase != null && spyBase !== 0) {
      const c = benchmarkCloseOnOrBefore("SPY", r.month_end);
      spyPct = c != null ? ((c / spyBase) - 1) * 100 : null;
    }
    if (includeQqq && qqqBase != null && qqqBase !== 0) {
      const c = benchmarkCloseOnOrBefore("QQQ", r.month_end);
      qqqPct = c != null ? ((c / qqqBase) - 1) * 100 : null;
    }

    return {
      month_end: r.month_end,
      portfolio_rebased_pct: r.portfolio_rebased_pct,
      price_only_rebased_pct: r.price_only_rebased_pct,
      total_market_value: r.nav_total,
      total_dividends: r.total_dividends ?? 0,
      spy_rebased_pct: spyPct,
      qqq_rebased_pct: qqqPct,
      status: r.status,
    };
  });

  return { points, totalDividendsReceived };
}

export function assertPortfolioExists(db: Database.Database, portfolioId: string): boolean {
  const row = db.prepare(`SELECT 1 AS x FROM dividend_model_portfolios WHERE id = ? LIMIT 1`).get(portfolioId) as
    | { x: number }
    | undefined;
  return !!row;
}

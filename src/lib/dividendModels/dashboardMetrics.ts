import type Database from "better-sqlite3";

export type DashboardIncome = {
  allTime: number;
  ytd: number;
  last30d: number;
  last7d: number;
  paymentCount: number;
};

export type DashboardUpcoming = {
  next30dAmount: number;
  paymentsComing: number;
  nextPayer: string | null;
  nextDate: string | null;
};

export type DashboardGrowth = {
  dripShares: number;
  avgDaysBetweenPayments: number | null;
  avgWeeklyContribution: number | null;
  annualRunRate: number | null;
  monthlyAvg: number | null;
};

export type SectorSlice = { sector: string; value: number; pct: number };
export type TreemapLeaf = { name: string; symbol: string; value: number };
export type CumulativeMonth = { month: string; amount: number; cumulative: number };

export type PositionRow = {
  symbol: string;
  category: string;
  shares: number | null;
  avgUnitCost: number | null;
  cost: number | null;
  last: number | null;
  marketValue: number | null;
  sector: string | null;
  industry: string | null;
};

export type HoldingValuation = {
  symbol: string;
  shares: number | null;
  last: number | null;
  marketValue: number | null;
  sector: string | null;
  industry: string | null;
  avgUnitCost: number | null;
};

export type DividendCashRow = { symbol: string; amount: number; payDay: string };

export type PortfolioDashboard = {
  totalPositions: number;
  totalShares: number;
  totalValue: number;
  largest: { symbol: string; pct: number } | null;
  smallest: { symbol: string; pct: number } | null;
  income: DashboardIncome;
  growth: DashboardGrowth;
  upcoming: DashboardUpcoming;
  milestonesHit: number;
  diversificationScore: number | null;
  sectorBreakdown: SectorSlice[];
  treemap: TreemapLeaf[];
  cumulativeDividends: CumulativeMonth[];
  positions: PositionRow[];
  /** Present when portfolio is linked to a Schwab account slice. */
  slice?: PortfolioSlicePayload | null;
};

/** Schwab slice summary for the dividend center hub. */
export type PortfolioSlicePayload = {
  accountId: string;
  snapshotId: string | null;
  snapshotAsOf: string | null;
  schwabMarketValue: number;
  schwabCostBasis: number;
  unrealizedPl: number;
  matchedPositions: number;
  missingSymbols: string[];
  /** Sum of dividend cashflows in the last ~12 months for this account + tickers. */
  trailingTwelveMonthsDividends: number;
  /** Sum of scheduled/projected dividends with pay_date in the next 365 days (same scope). */
  forwardYearProjectedDividends: number;
};

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

export function fetchDividendCashflowsForSymbols(
  db: Database.Database,
  symbols: string[],
  accountId?: string | null,
): DividendCashRow[] {
  if (symbols.length === 0) return [];
  const uniq = Array.from(new Set(symbols.map((s) => s.trim().toUpperCase())));
  const ph = uniq.map(() => "?").join(",");
  const acct = accountId?.trim() ?? "";
  return db
    .prepare(
      acct
        ? `
      SELECT UPPER(s.symbol) AS symbol, cf.amount AS amount, substr(cf.pay_date, 1, 10) AS payDay
      FROM cashflows cf
      INNER JOIN securities s ON s.id = cf.security_id
      WHERE UPPER(s.symbol) IN (${ph})
        AND cf.account_id = ?
        AND cf.type IN ('dividend_actual', 'dividend_projected')
        AND substr(cf.pay_date, 1, 10) IS NOT NULL
        AND length(substr(cf.pay_date, 1, 10)) >= 10
      ORDER BY payDay ASC
    `
        : `
      SELECT UPPER(s.symbol) AS symbol, cf.amount AS amount, substr(cf.pay_date, 1, 10) AS payDay
      FROM cashflows cf
      INNER JOIN securities s ON s.id = cf.security_id
      WHERE UPPER(s.symbol) IN (${ph})
        AND cf.type IN ('dividend_actual', 'dividend_projected')
        AND substr(cf.pay_date, 1, 10) IS NOT NULL
        AND length(substr(cf.pay_date, 1, 10)) >= 10
      ORDER BY payDay ASC
    `,
    )
    .all(...(acct ? [...uniq, acct] : uniq)) as DividendCashRow[];
}

export function buildPortfolioDashboard(
  holdings: HoldingValuation[],
  dividends: DividendCashRow[],
  inferCategory: (symbol: string, sector: string | null, industry: string | null) => string,
): PortfolioDashboard {
  const today = isoDate(new Date());
  const y0 = new Date();
  const yStart = `${y0.getUTCFullYear()}-01-01`;
  const d30 = new Date();
  d30.setUTCDate(d30.getUTCDate() - 30);
  const d7 = new Date();
  d7.setUTCDate(d7.getUTCDate() - 7);
  const iso30 = isoDate(d30);
  const iso7 = isoDate(d7);

  const sumInRange = (start: string | null, end: string | null) => {
    let t = 0;
    for (const r of dividends) {
      if (start && r.payDay < start) continue;
      if (end && r.payDay > end) continue;
      t += typeof r.amount === "number" && Number.isFinite(r.amount) ? r.amount : 0;
    }
    return t;
  };

  const income: DashboardIncome = {
    allTime: sumInRange(null, null),
    ytd: sumInRange(yStart, today),
    last30d: sumInRange(iso30, today),
    last7d: sumInRange(iso7, today),
    paymentCount: dividends.length,
  };

  const dUpEnd = new Date();
  dUpEnd.setUTCDate(dUpEnd.getUTCDate() + 30);
  const upEnd = isoDate(dUpEnd);
  const upcomingList = dividends.filter((r) => r.payDay >= today && r.payDay <= upEnd).sort((a, b) => a.payDay.localeCompare(b.payDay));
  const upcomingAmount = upcomingList.reduce((s, r) => s + r.amount, 0);
  const next = upcomingList[0];

  const upcoming: DashboardUpcoming = {
    next30dAmount: upcomingAmount,
    paymentsComing: upcomingList.length,
    nextPayer: next?.symbol ?? null,
    nextDate: next?.payDay ?? null,
  };

  const payDays = Array.from(new Set(dividends.map((r) => r.payDay))).sort();
  let avgDays: number | null = null;
  if (payDays.length >= 2) {
    const first = new Date(payDays[0]! + "T12:00:00Z").getTime();
    const last = new Date(payDays[payDays.length - 1]! + "T12:00:00Z").getTime();
    avgDays = (last - first) / (86400000 * Math.max(1, payDays.length - 1));
  }

  const mStart = isoDate(new Date(Date.UTC(y0.getUTCFullYear(), y0.getUTCMonth() - 11, 1)));
  const last12m = sumInRange(mStart, today);
  const monthlyAvg = last12m > 0 ? last12m / 12 : null;
  const annualRunRate = monthlyAvg != null ? monthlyAvg * 12 : null;
  const avgWeeklyContribution = monthlyAvg != null ? (monthlyAvg * 12) / 52 : null;

  const growth: DashboardGrowth = {
    dripShares: 0,
    avgDaysBetweenPayments: avgDays,
    avgWeeklyContribution,
    annualRunRate,
    monthlyAvg,
  };

  const totalValue = holdings.reduce((s, r) => s + (r.marketValue != null && Number.isFinite(r.marketValue) ? r.marketValue : 0), 0);
  const totalShares = holdings.reduce((s, r) => s + (r.shares != null && Number.isFinite(r.shares) ? r.shares : 0), 0);

  const weights = holdings
    .map((r) => ({
      sym: r.symbol,
      w: totalValue > 0 && r.marketValue != null && Number.isFinite(r.marketValue) ? r.marketValue / totalValue : 0,
    }))
    .filter((x) => x.w > 0)
    .sort((a, b) => b.w - a.w);

  const largest = weights[0] ? { symbol: weights[0].sym, pct: weights[0].w * 100 } : null;
  const smallest = weights.length ? { symbol: weights[weights.length - 1]!.sym, pct: weights[weights.length - 1]!.w * 100 } : null;

  let hhi = 0;
  for (const x of weights) hhi += x.w * x.w;
  const diversificationScore = weights.length > 0 ? Math.round((1 - hhi) * 100) : null;

  const sectorMap = new Map<string, number>();
  for (const r of holdings) {
    if (r.marketValue == null || !Number.isFinite(r.marketValue) || r.marketValue <= 0) continue;
    const key = (r.sector ?? "Unclassified").trim() || "Unclassified";
    sectorMap.set(key, (sectorMap.get(key) ?? 0) + r.marketValue);
  }
  const sectorBreakdown: SectorSlice[] = [];
  for (const [sector, value] of sectorMap.entries()) {
    sectorBreakdown.push({
      sector,
      value,
      pct: totalValue > 0 ? (value / totalValue) * 100 : 0,
    });
  }
  sectorBreakdown.sort((a, b) => b.value - a.value);

  const treemap: TreemapLeaf[] = holdings
    .filter((r) => r.marketValue != null && r.marketValue > 0)
    .map((r) => ({ name: r.symbol, symbol: r.symbol, value: r.marketValue! }))
    .sort((a, b) => b.value - a.value);

  const byMonth = new Map<string, number>();
  for (const r of dividends) {
    const m = r.payDay.slice(0, 7);
    byMonth.set(m, (byMonth.get(m) ?? 0) + r.amount);
  }
  const monthsSorted = Array.from(byMonth.keys()).sort();
  let cum = 0;
  const cumulativeDividends: CumulativeMonth[] = monthsSorted.map((month) => {
    const amount = byMonth.get(month) ?? 0;
    cum += amount;
    return { month, amount, cumulative: cum };
  });

  const positions: PositionRow[] = holdings.map((r) => {
    const sh = r.shares;
    const avg = r.avgUnitCost;
    const cost =
      sh != null && avg != null && Number.isFinite(sh) && Number.isFinite(avg) && sh > 0 && avg >= 0 ? sh * avg : null;
    return {
      symbol: r.symbol,
      category: inferCategory(r.symbol, r.sector, r.industry),
      shares: sh,
      avgUnitCost: avg,
      cost,
      last: r.last,
      marketValue: r.marketValue,
      sector: r.sector,
      industry: r.industry,
    };
  });

  const milestonesHit = [100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000].filter((t) => income.allTime >= t).length;

  return {
    totalPositions: holdings.length,
    totalShares,
    totalValue,
    largest,
    smallest,
    income,
    growth,
    upcoming,
    milestonesHit,
    diversificationScore,
    sectorBreakdown,
    treemap,
    cumulativeDividends,
    positions,
  };
}

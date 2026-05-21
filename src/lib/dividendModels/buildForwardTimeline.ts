import type Database from "better-sqlite3";

import { ensureBenchmarkHistory } from "@/lib/market/benchmarks";

import { dividendsForHoldingsSinceLiveStart } from "./forwardSnap";
import { benchmarkCloseOnOrBefore } from "./prices";

export type ForwardTimelinePoint = {
  as_of: string;
  nav_total: number | null;
  dividends_period: number;
  portfolio_rebased_pct: number | null;
  spy_rebased_pct: number | null;
  qqq_rebased_pct: number | null;
  status: string;
};

export type ForwardTimelineResult = {
  points: ForwardTimelinePoint[];
  liveStartedAt: string | null;
  totalDividendsReceived: number;
};

export async function buildForwardTimeline(
  db: Database.Database,
  portfolioId: string,
  includeSpy: boolean,
  includeQqq: boolean,
): Promise<ForwardTimelineResult> {
  const portfolio = db
    .prepare(`SELECT live_started_at AS liveStartedAt FROM dividend_model_portfolios WHERE id = ?`)
    .get(portfolioId) as { liveStartedAt: string | null } | undefined;

  const liveStartedAt = portfolio?.liveStartedAt ?? null;
  if (!liveStartedAt) {
    return { points: [], liveStartedAt: null, totalDividendsReceived: 0 };
  }

  const liveDate = liveStartedAt.slice(0, 10);
  const rows = db
    .prepare(
      `
      SELECT as_of, nav_total, dividends_period, status
      FROM dividend_model_portfolio_forward_snap
      WHERE portfolio_id = ? AND as_of >= ?
      ORDER BY as_of ASC
    `,
    )
    .all(portfolioId, liveDate) as Array<{
    as_of: string;
    nav_total: number | null;
    dividends_period: number;
    status: string;
  }>;

  if (rows.length === 0) return { points: [], liveStartedAt, totalDividendsReceived: 0 };

  const holdings = db
    .prepare(`SELECT symbol, shares FROM dividend_model_holdings WHERE portfolio_id = ?`)
    .all(portfolioId) as Array<{ symbol: string; shares: number | null }>;
  const withShares = holdings
    .filter((h) => h.shares != null && Number.isFinite(h.shares) && h.shares! > 0)
    .map((h) => ({ symbol: h.symbol.toUpperCase(), shares: h.shares! }));

  const lastAsOf = rows[rows.length - 1]!.as_of;
  const totalDividendsReceived =
    withShares.length > 0
      ? dividendsForHoldingsSinceLiveStart(db, withShares, liveStartedAt, lastAsOf)
      : rows.reduce((sum, r) => sum + Math.max(0, Number(r.dividends_period) || 0), 0);

  if (includeSpy) await ensureBenchmarkHistory("SPY");
  if (includeQqq) await ensureBenchmarkHistory("QQQ");

  const firstAsOf = rows[0]!.as_of;
  const firstNav = rows[0]!.nav_total;
  let spyBase: number | null = null;
  let qqqBase: number | null = null;
  if (includeSpy) spyBase = benchmarkCloseOnOrBefore("SPY", firstAsOf);
  if (includeQqq) qqqBase = benchmarkCloseOnOrBefore("QQQ", firstAsOf);

  const points: ForwardTimelinePoint[] = rows.map((r) => {
    const nav = r.nav_total;
    const rebased =
      firstNav != null && nav != null && firstNav > 0 ? ((nav / firstNav) - 1) * 100 : null;

    let spyPct: number | null = null;
    let qqqPct: number | null = null;
    if (includeSpy && spyBase != null && spyBase !== 0) {
      const c = benchmarkCloseOnOrBefore("SPY", r.as_of);
      spyPct = c != null ? ((c / spyBase) - 1) * 100 : null;
    }
    if (includeQqq && qqqBase != null && qqqBase !== 0) {
      const c = benchmarkCloseOnOrBefore("QQQ", r.as_of);
      qqqPct = c != null ? ((c / qqqBase) - 1) * 100 : null;
    }

    return {
      as_of: r.as_of,
      nav_total: nav,
      dividends_period: r.dividends_period,
      portfolio_rebased_pct: rebased,
      spy_rebased_pct: spyPct,
      qqq_rebased_pct: qqqPct,
      status: r.status,
    };
  });

  return { points, liveStartedAt, totalDividendsReceived };
}

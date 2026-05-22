import type Database from "better-sqlite3";

import { loadEnrichedHoldings } from "./enrichedHoldings";
import { anchorMonthEndForWindowYears, readBacktestAnchorClose } from "./symbolBacktestAnchor";
import { targetNavUsdForPortfolio } from "./constants";
import type { SimulationHolding } from "./portfolioSimulation";
import type { BacktestWindowYears } from "./symbolBacktestAnchor";
import type { TimelineYears } from "./types";

const BACKTEST_WINDOWS: BacktestWindowYears[] = [1, 3, 5];

export type SyntheticHoldingRow = {
  symbol: string;
  synthetic_shares: number;
  anchor_month_end: string;
  target_nav_usd: number;
  weight_pct: number;
};

function timelineYearsToBacktest(years: TimelineYears): BacktestWindowYears {
  return years as BacktestWindowYears;
}

/** MV weights for symbols that have a valid anchor close (renormalized to sum 1). */
export function buildMvWeights(
  enriched: Array<{ symbol: string; marketValue: number | null }>,
  anchorCloses: Map<string, number>,
): Map<string, number> {
  const eligible = enriched
    .map((h) => {
      const sym = h.symbol.toUpperCase();
      const close = anchorCloses.get(sym);
      if (close == null || close <= 0) return null;
      const mv = h.marketValue != null && Number.isFinite(h.marketValue) && h.marketValue > 0 ? h.marketValue : 0;
      return { sym, mv };
    })
    .filter((x): x is { sym: string; mv: number } => x != null);

  if (eligible.length === 0) return new Map();

  const totalMv = eligible.reduce((s, x) => s + x.mv, 0);
  const weights = new Map<string, number>();

  if (totalMv > 0) {
    for (const { sym, mv } of eligible) {
      weights.set(sym, mv / totalMv);
    }
    return weights;
  }

  const eq = 1 / eligible.length;
  for (const { sym } of eligible) weights.set(sym, eq);
  return weights;
}

export function computeSyntheticHoldingRows(
  enriched: Array<{ symbol: string; marketValue: number | null }>,
  anchorCloses: Map<string, number>,
  anchorMonthEnd: string,
  targetNavUsd: number,
): SyntheticHoldingRow[] {
  const weights = buildMvWeights(enriched, anchorCloses);
  const rows: SyntheticHoldingRow[] = [];
  for (const [sym, weight] of weights) {
    const close = anchorCloses.get(sym)!;
    const syntheticShares = (targetNavUsd * weight) / close;
    if (!Number.isFinite(syntheticShares) || syntheticShares <= 0) continue;
    rows.push({
      symbol: sym,
      synthetic_shares: syntheticShares,
      anchor_month_end: anchorMonthEnd,
      target_nav_usd: targetNavUsd,
      weight_pct: weight * 100,
    });
  }
  return rows;
}

export async function persistSyntheticHoldingsForWindow(
  db: Database.Database,
  portfolioId: string,
  windowYears: BacktestWindowYears,
  now: Date = new Date(),
): Promise<number> {
  const enriched = await loadEnrichedHoldings(db, portfolioId);
  if (enriched.length === 0) return 0;

  const totalMv = enriched.reduce(
    (s, h) => s + (h.marketValue != null && Number.isFinite(h.marketValue) && h.marketValue > 0 ? h.marketValue : 0),
    0,
  );
  const targetNavUsd = targetNavUsdForPortfolio(portfolioId, totalMv);
  const anchorMonthEnd = anchorMonthEndForWindowYears(now, windowYears);

  const anchorCloses = new Map<string, number>();
  for (const h of enriched) {
    const sym = h.symbol.toUpperCase();
    const close = readBacktestAnchorClose(db, sym, windowYears);
    if (close != null) anchorCloses.set(sym, close);
  }

  const rows = computeSyntheticHoldingRows(enriched, anchorCloses, anchorMonthEnd, targetNavUsd);
  const computedAt = now.toISOString();

  const del = db.prepare(
    `DELETE FROM dividend_model_synthetic_holdings WHERE portfolio_id = ? AND window_years = ?`,
  );
  const ins = db.prepare(
    `
    INSERT INTO dividend_model_synthetic_holdings
      (portfolio_id, window_years, symbol, synthetic_shares, anchor_month_end, target_nav_usd, weight_pct, computed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `,
  );

  const tx = db.transaction(() => {
    del.run(portfolioId, windowYears);
    for (const r of rows) {
      ins.run(
        portfolioId,
        windowYears,
        r.symbol,
        r.synthetic_shares,
        r.anchor_month_end,
        r.target_nav_usd,
        r.weight_pct,
        computedAt,
      );
    }
  });
  tx();
  return rows.length;
}

export async function persistSyntheticHoldingsForAllWindows(
  db: Database.Database,
  portfolioId: string,
  now: Date = new Date(),
): Promise<number> {
  let total = 0;
  for (const wy of BACKTEST_WINDOWS) {
    total += await persistSyntheticHoldingsForWindow(db, portfolioId, wy, now);
  }
  return total;
}

export function loadSyntheticHoldings(
  db: Database.Database,
  portfolioId: string,
  years: TimelineYears,
): SimulationHolding[] {
  const windowYears = timelineYearsToBacktest(years);
  const rows = db
    .prepare(
      `
      SELECT symbol, synthetic_shares AS shares
      FROM dividend_model_synthetic_holdings
      WHERE portfolio_id = ? AND window_years = ?
      ORDER BY symbol ASC
    `,
    )
    .all(portfolioId, windowYears) as Array<{ symbol: string; shares: number }>;

  return rows
    .filter((r) => Number.isFinite(r.shares) && r.shares > 0)
    .map((r) => ({ symbol: r.symbol.toUpperCase(), shares: r.shares }));
}

export function syntheticHoldingsNavAtAnchor(
  db: Database.Database,
  portfolioId: string,
  years: TimelineYears,
): number | null {
  const windowYears = timelineYearsToBacktest(years);
  const rows = db
    .prepare(
      `
      SELECT symbol, synthetic_shares, target_nav_usd
      FROM dividend_model_synthetic_holdings
      WHERE portfolio_id = ? AND window_years = ?
    `,
    )
    .all(portfolioId, windowYears) as Array<{ symbol: string; synthetic_shares: number; target_nav_usd: number }>;

  if (rows.length === 0) return null;

  let nav = 0;
  let any = false;
  for (const r of rows) {
    const close = readBacktestAnchorClose(db, r.symbol, windowYears);
    if (close == null) continue;
    nav += r.synthetic_shares * close;
    any = true;
  }
  if (!any || nav <= 0) return rows[0]?.target_nav_usd ?? null;
  return nav;
}

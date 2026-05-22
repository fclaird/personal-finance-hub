import type Database from "better-sqlite3";

import { enrichSymbolHoldings } from "@/lib/dividends/symbolEnrichment";

export type LoadEnrichedHoldingsOptions = {
  /** Re-run Schwab/Yahoo fundamentals for every holding symbol (use after fixing Connections or bad snapshots). */
  forceRefetchFundamentals?: boolean;
};

export type EnrichedHoldingRow = {
  holdingId: string;
  symbol: string;
  displayName: string | null;
  shares: number | null;
  sortOrder: number;
  last: number | null;
  divYield: number | null;
  annualDivEst: number | null;
  marketValue: number | null;
  nextExDate: string | null;
  sector: string | null;
  industry: string | null;
  avgUnitCost: number | null;
  category: string;
  cost: number | null;
};

export async function loadEnrichedHoldings(
  db: Database.Database,
  portfolioId: string,
  options?: LoadEnrichedHoldingsOptions,
): Promise<EnrichedHoldingRow[]> {
  const holdings = db
    .prepare(
      `
      SELECT id, symbol, shares, sort_order AS sortOrder, avg_unit_cost AS avgUnitCost
      FROM dividend_model_holdings
      WHERE portfolio_id = ?
      ORDER BY sort_order ASC, symbol ASC
    `,
    )
    .all(portfolioId) as Array<{
    id: string;
    symbol: string;
    shares: number | null;
    sortOrder: number;
    avgUnitCost: number | null;
  }>;

  return enrichSymbolHoldings(
    db,
    holdings.map((h) => ({
      holdingId: h.id,
      symbol: h.symbol,
      shares: h.shares,
      sortOrder: h.sortOrder,
      avgUnitCost: h.avgUnitCost,
    })),
    options,
  );
}

export function computeFooterTotals(rows: EnrichedHoldingRow[]) {
  let totalShares = 0;
  let totalMv = 0;
  let totalAnnualDiv = 0;
  let yieldNum = 0;
  for (const r of rows) {
    if (r.shares != null && Number.isFinite(r.shares)) totalShares += r.shares;
    if (r.marketValue != null && Number.isFinite(r.marketValue)) totalMv += r.marketValue;
    if (r.annualDivEst != null && r.shares != null && Number.isFinite(r.annualDivEst) && Number.isFinite(r.shares) && r.shares > 0) {
      totalAnnualDiv += r.annualDivEst * r.shares;
    }
    const px =
      r.last ??
      (r.shares != null && r.shares > 0 && r.marketValue != null && r.marketValue > 0 ? r.marketValue / r.shares : null);
    const impliedYield =
      r.divYield != null && Number.isFinite(r.divYield) && r.divYield >= 0
        ? r.divYield
        : px != null && px > 0 && r.annualDivEst != null && Number.isFinite(r.annualDivEst) && r.annualDivEst >= 0
          ? r.annualDivEst / px
          : null;
    if (impliedYield != null && r.marketValue != null && r.marketValue > 0 && Number.isFinite(impliedYield)) {
      yieldNum += impliedYield * r.marketValue;
    }
  }
  let portfolioYieldPct = totalMv > 0 && yieldNum > 0 ? (yieldNum / totalMv) * 100 : null;
  if (portfolioYieldPct == null && totalMv > 0 && totalAnnualDiv > 0) {
    portfolioYieldPct = (totalAnnualDiv / totalMv) * 100;
  }
  return {
    totalShares,
    totalMv,
    totalAnnualDiv,
    portfolioYieldPct,
  };
}

import type Database from "better-sqlite3";

import {
  buildPortfolioDashboard,
  fetchDividendCashflowsForSymbols,
  type PortfolioDashboard,
} from "./dashboardMetrics";
import { filterDividendProducingHoldings } from "./dividendProducingFilter";
import type { EnrichedHoldingRow } from "./enrichedHoldings";
import { ensureLiveStartedAt } from "./forwardSnap";
import { inferHoldingCategory } from "./holdingCategory";
import { loadEnrichedHoldings } from "./enrichedHoldings";
import { parsePortfolioMeta } from "./portfolioMeta";

export function ensurePortfolioLiveMode(db: Database.Database, portfolioId: string): string {
  db.prepare(`UPDATE dividend_model_portfolios SET tracking_mode = 'live' WHERE id = ?`).run(portfolioId);
  return ensureLiveStartedAt(db, portfolioId);
}

export async function loadDividendTabHoldings(
  db: Database.Database,
  portfolioId: string,
  opts?: { forceRefetchFundamentals?: boolean },
): Promise<EnrichedHoldingRow[]> {
  const enriched = await loadEnrichedHoldings(db, portfolioId, opts);
  return filterDividendProducingHoldings(db, enriched);
}

export function buildLivePortfolioDashboard(
  db: Database.Database,
  portfolioId: string,
  holdings: EnrichedHoldingRow[],
): PortfolioDashboard {
  const meta = parsePortfolioMeta(
    (
      db.prepare(`SELECT meta_json AS metaJson FROM dividend_model_portfolios WHERE id = ?`).get(portfolioId) as
        | { metaJson: string | null }
        | undefined
    )?.metaJson,
  );

  const symbols = holdings.map((h) => h.symbol.toUpperCase());
  const cashflows = fetchDividendCashflowsForSymbols(db, symbols, meta.sliceAccountId ?? null);

  return buildPortfolioDashboard(
    holdings.map((r) => ({
      symbol: r.symbol,
      shares: r.shares,
      last: r.last,
      marketValue: r.marketValue,
      sector: r.sector,
      industry: r.industry,
      avgUnitCost: r.avgUnitCost,
    })),
    cashflows,
    inferHoldingCategory,
  );
}

export async function buildLivePortfolioDashboardForPortfolio(
  db: Database.Database,
  portfolioId: string,
  opts?: { forceRefetchFundamentals?: boolean },
): Promise<{ holdings: EnrichedHoldingRow[]; dashboard: PortfolioDashboard }> {
  const holdings = await loadDividendTabHoldings(db, portfolioId, opts);
  const dashboard = buildLivePortfolioDashboard(db, portfolioId, holdings);
  return { holdings, dashboard };
}

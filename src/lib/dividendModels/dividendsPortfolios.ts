import type Database from "better-sqlite3";

import { DIVIDEND_MODEL_PRESET_PORTFOLIOS } from "./constants";
import { countDividendHoldingsInPortfolio } from "./dividendProducingFilter";
import { parsePortfolioMeta } from "./portfolioMeta";
import { ensurePresetDividendPortfolios } from "./seed";

export type DividendsPortfolioRow = {
  id: string;
  name: string;
  createdAt: string;
  liveStartedAt: string | null;
  trackingMode: "live" | "backtest";
  dividendHoldingCount: number;
  sliceAccountId: string | null;
};

const PRESET_ORDER = Object.fromEntries(
  DIVIDEND_MODEL_PRESET_PORTFOLIOS.map((p, i) => [p.id, i]),
) as Record<string, number>;

function sortPortfolios(list: DividendsPortfolioRow[]): DividendsPortfolioRow[] {
  return [...list].sort((a, b) => {
    const ao = PRESET_ORDER[a.id] ?? 999;
    const bo = PRESET_ORDER[b.id] ?? 999;
    if (ao !== bo) return ao - bo;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

export function listDividendEligiblePortfolios(db: Database.Database): DividendsPortfolioRow[] {
  ensurePresetDividendPortfolios(db);

  const rows = db
    .prepare(
      `
      SELECT
        p.id AS id,
        p.name AS name,
        p.created_at AS createdAt,
        p.live_started_at AS liveStartedAt,
        p.tracking_mode AS trackingMode,
        p.meta_json AS metaJson
      FROM dividend_model_portfolios p
      ORDER BY p.created_at ASC, p.name ASC
    `,
    )
    .all() as Array<{
    id: string;
    name: string;
    createdAt: string;
    liveStartedAt: string | null;
    trackingMode: string | null;
    metaJson: string | null;
  }>;

  const eligible: DividendsPortfolioRow[] = [];
  for (const r of rows) {
    const dividendHoldingCount = countDividendHoldingsInPortfolio(db, r.id);
    if (dividendHoldingCount === 0) continue;
    const meta = parsePortfolioMeta(r.metaJson);
    eligible.push({
      id: r.id,
      name: r.name,
      createdAt: r.createdAt,
      liveStartedAt: r.liveStartedAt,
      trackingMode: r.trackingMode === "live" ? "live" : "backtest",
      dividendHoldingCount,
      sliceAccountId: meta.sliceAccountId ?? null,
    });
  }

  return sortPortfolios(eligible);
}

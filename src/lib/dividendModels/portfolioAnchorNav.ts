import type Database from "better-sqlite3";

import { readBacktestAnchorClose } from "./symbolBacktestAnchor";
import type { TimelineYears } from "./types";

/** Portfolio NAV at backtest window start using stored anchor closes (not purchase price). */
export function portfolioAnchorNav(
  db: Database.Database,
  portfolioId: string,
  windowYears: TimelineYears,
): number | null {
  const holdings = db
    .prepare(`SELECT symbol, shares FROM dividend_model_holdings WHERE portfolio_id = ?`)
    .all(portfolioId) as Array<{ symbol: string; shares: number | null }>;

  let nav = 0;
  let any = false;
  for (const h of holdings) {
    if (h.shares == null || !Number.isFinite(h.shares) || h.shares <= 0) continue;
    const close = readBacktestAnchorClose(db, h.symbol, windowYears);
    if (close == null) continue;
    nav += h.shares * close;
    any = true;
  }
  return any && nav > 0 ? nav : null;
}

/** Frozen-share NAV at backtest window start (same anchor month closes). */
export function portfolioPriceOnlyAnchorNav(
  db: Database.Database,
  portfolioId: string,
  windowYears: TimelineYears,
): number | null {
  return portfolioAnchorNav(db, portfolioId, windowYears);
}

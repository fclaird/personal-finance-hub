import type Database from "better-sqlite3";

import { getDb } from "@/lib/db";

import { captureFundamentalsForSymbols } from "./captureFundamentals";
import { captureForwardSnapForPortfolio } from "./forwardSnap";
import { materializePortfolioMonthlyHistory } from "./materializePortfolioHistory";
import { persistSyntheticHoldingsForAllWindows } from "./syntheticHoldings";
import { persistSymbolBacktestAnchors } from "./symbolBacktestAnchor";
import { ensureSymbolDisplayNames } from "./symbolDisplayName";
import { backfillSymbolMonthlyMarket } from "./symbolMonthlyMarket";
import type { TrackingMode } from "./types";

export type RefreshFundamentalsResult = {
  ok: true;
  symbols: number;
  fundamentalsCaptured: number;
  symbolFactsRows: number;
  paymentRows: number;
  displayNamesUpdated: number;
  anchorRows: number;
  monthlyRows: number;
  simRows: number;
  forwardSnap?: boolean;
  partial?: boolean;
  message?: string;
};

export type RefreshFundamentalsOptions = {
  fundamentalsOnly?: boolean;
  /** Skip monthly materialization, anchors, and synthetic backtest shares (Dividends tab live refresh). */
  skipMaterialize?: boolean;
  /** When live, capture a forward snap after refresh. */
  captureForward?: boolean;
};

export async function refreshPortfolioFundamentals(
  portfolioId: string,
  db: Database.Database = getDb(),
  opts?: RefreshFundamentalsOptions,
): Promise<RefreshFundamentalsResult> {
  const portfolio = db
    .prepare(`SELECT tracking_mode AS trackingMode, live_started_at AS liveStartedAt FROM dividend_model_portfolios WHERE id = ?`)
    .get(portfolioId) as { trackingMode: string | null; liveStartedAt: string | null } | undefined;

  if (!portfolio) {
    return {
      ok: true,
      symbols: 0,
      fundamentalsCaptured: 0,
      symbolFactsRows: 0,
      paymentRows: 0,
      displayNamesUpdated: 0,
      anchorRows: 0,
      monthlyRows: 0,
      simRows: 0,
      message: "Portfolio not found",
    };
  }

  const holdings = db
    .prepare(
      `SELECT id, symbol, shares FROM dividend_model_holdings WHERE portfolio_id = ? ORDER BY sort_order ASC, symbol ASC`,
    )
    .all(portfolioId) as Array<{ id: string; symbol: string; shares: number | null }>;

  const symbols = holdings.map((h) => h.symbol.toUpperCase());
  if (symbols.length === 0) {
    return {
      ok: true,
      symbols: 0,
      fundamentalsCaptured: 0,
      symbolFactsRows: 0,
      paymentRows: 0,
      displayNamesUpdated: 0,
      anchorRows: 0,
      monthlyRows: 0,
      simRows: 0,
      message: "No holdings",
    };
  }

  const { captured: fundamentalsCaptured } = await captureFundamentalsForSymbols(db, symbols, { skipYahoo: true });

  if (opts?.fundamentalsOnly) {
    const displayNamesUpdated = await ensureSymbolDisplayNames(db, symbols);
    return {
      ok: true,
      symbols: symbols.length,
      fundamentalsCaptured,
      symbolFactsRows: 0,
      paymentRows: 0,
      displayNamesUpdated,
      anchorRows: 0,
      monthlyRows: 0,
      simRows: 0,
    };
  }

  if (opts?.skipMaterialize) {
    const facts = await backfillSymbolMonthlyMarket(db, symbols);
    const displayNamesUpdated = await ensureSymbolDisplayNames(db, symbols);
    db.prepare(`UPDATE dividend_model_portfolios SET tracking_mode = 'live' WHERE id = ?`).run(portfolioId);
    let forwardSnap = false;
    if (opts.captureForward !== false) {
      await captureForwardSnapForPortfolio(db, portfolioId);
      forwardSnap = true;
    }
    return {
      ok: true,
      symbols: symbols.length,
      fundamentalsCaptured,
      symbolFactsRows: facts.rowsUpserted,
      paymentRows: facts.paymentRowsUpserted,
      displayNamesUpdated,
      anchorRows: 0,
      monthlyRows: 0,
      simRows: 0,
      forwardSnap,
    };
  }

  const facts = await backfillSymbolMonthlyMarket(db, symbols);
  const displayNamesUpdated = await ensureSymbolDisplayNames(db, symbols);
  const anchorRows = persistSymbolBacktestAnchors(db, symbols);

  const anyMissingShares = holdings.some((h) => h.shares == null || !Number.isFinite(h.shares) || h.shares <= 0);
  let monthlyRows = 0;
  let simRows = 0;
  let message: string | undefined;

  if (anyMissingShares) {
    message = "Set finite share counts on every holding to rebuild chart simulation";
  } else {
    const materialized = materializePortfolioMonthlyHistory(db, portfolioId, holdings);
    monthlyRows = materialized.monthlyRows;
    simRows = materialized.simRows;
    await persistSyntheticHoldingsForAllWindows(db, portfolioId);
  }

  const trackingMode = (portfolio.trackingMode === "live" ? "live" : "backtest") as TrackingMode;
  let forwardSnap = false;
  if (trackingMode === "live" && opts?.captureForward !== false) {
    await captureForwardSnapForPortfolio(db, portfolioId);
    forwardSnap = true;
  }

  return {
    ok: true,
    symbols: symbols.length,
    fundamentalsCaptured,
    symbolFactsRows: facts.rowsUpserted,
    paymentRows: facts.paymentRowsUpserted,
    displayNamesUpdated,
    anchorRows,
    monthlyRows,
    simRows,
    forwardSnap,
    partial: anyMissingShares,
    message,
  };
}

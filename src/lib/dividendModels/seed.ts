import type Database from "better-sqlite3";

import { getDb } from "@/lib/db";
import { newId } from "@/lib/id";

import {
  DEFAULT_DIVIDEND_MODEL_SYMBOLS,
  DIVIDEND_MODEL_PRESET_PORTFOLIOS,
  type DividendModelPresetPortfolio,
} from "./constants";
import { scaleSharesForMultiplier } from "./syncScaledShares";

type HoldingRow = {
  symbol: string;
  sort_order: number;
  shares: number | null;
  avg_unit_cost: number | null;
};

/** Clone holdings from source; scaled portfolios keep separate materialized sim rows. */
export function cloneHoldingsFromPortfolio(
  db: Database.Database,
  sourceId: string,
  targetId: string,
  multiplier: number,
): void {
  const holdings = db
    .prepare(
      `SELECT symbol, sort_order, shares, avg_unit_cost FROM dividend_model_holdings WHERE portfolio_id = ? ORDER BY sort_order ASC`,
    )
    .all(sourceId) as HoldingRow[];

  const ins = db.prepare(
    `INSERT INTO dividend_model_holdings (id, portfolio_id, symbol, sort_order, shares, avg_unit_cost) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const h of holdings) {
    ins.run(
      newId("dmh"),
      targetId,
      h.symbol,
      h.sort_order,
      scaleSharesForMultiplier(h.shares, multiplier),
      h.avg_unit_cost,
    );
  }
}

function insertAlphaSymbols(db: Database.Database, portfolioId: string): void {
  const ins = db.prepare(
    `INSERT INTO dividend_model_holdings (id, portfolio_id, symbol, sort_order, shares) VALUES (?, ?, ?, ?, NULL)`,
  );
  DEFAULT_DIVIDEND_MODEL_SYMBOLS.forEach((sym, i) => {
    ins.run(newId("dmh"), portfolioId, sym.toUpperCase(), i);
  });
}

function portfolioExists(db: Database.Database, id: string): boolean {
  return db.prepare(`SELECT 1 FROM dividend_model_portfolios WHERE id = ?`).get(id) != null;
}

function insertPresetPortfolioRow(db: Database.Database, preset: DividendModelPresetPortfolio): void {
  db.prepare(
    `INSERT INTO dividend_model_portfolios (id, name, live_started_at, tracking_mode, meta_json) VALUES (?, ?, NULL, 'backtest', NULL)`,
  ).run(preset.id, preset.name);
}

function ensureScaledPreset(db: Database.Database, preset: DividendModelPresetPortfolio, alphaId: string): void {
  if (portfolioExists(db, preset.id)) return;
  insertPresetPortfolioRow(db, preset);
  cloneHoldingsFromPortfolio(db, alphaId, preset.id, preset.multiplier);
}

/**
 * Ensures alpha / bravo / charlie preset portfolios exist.
 * Bravo and charlie are cloned from alpha on first create; use syncScaledHoldingsFromAlpha to refresh shares.
 */
export function ensurePresetDividendPortfolios(db: Database.Database = getDb()): void {
  const alpha = DIVIDEND_MODEL_PRESET_PORTFOLIOS[0]!;
  const bravo = DIVIDEND_MODEL_PRESET_PORTFOLIOS[1]!;
  const charlie = DIVIDEND_MODEL_PRESET_PORTFOLIOS[2]!;

  const n = db.prepare(`SELECT COUNT(1) AS c FROM dividend_model_portfolios`).get() as { c: number };

  if ((n?.c ?? 0) === 0) {
    const tx = db.transaction(() => {
      insertPresetPortfolioRow(db, alpha);
      insertAlphaSymbols(db, alpha.id);
      insertPresetPortfolioRow(db, bravo);
      insertPresetPortfolioRow(db, charlie);
      cloneHoldingsFromPortfolio(db, alpha.id, bravo.id, bravo.multiplier);
      cloneHoldingsFromPortfolio(db, alpha.id, charlie.id, charlie.multiplier);
    });
    tx();
    return;
  }

  db.prepare(`UPDATE dividend_model_portfolios SET name = ? WHERE id = ?`).run(alpha.name, alpha.id);

  if (!portfolioExists(db, alpha.id)) {
    insertPresetPortfolioRow(db, alpha);
    insertAlphaSymbols(db, alpha.id);
  }

  ensureScaledPreset(db, bravo, alpha.id);
  ensureScaledPreset(db, charlie, alpha.id);
}

/** @deprecated Use ensurePresetDividendPortfolios */
export function ensureDefaultDividendModelPortfolio(db: Database.Database = getDb()): void {
  ensurePresetDividendPortfolios(db);
}

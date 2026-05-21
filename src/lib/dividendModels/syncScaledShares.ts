import type Database from "better-sqlite3";

import { newId } from "@/lib/id";

import {
  DEFAULT_DIVIDEND_MODEL_PORTFOLIO_ID,
  DIVIDEND_MODEL_PRESET_PORTFOLIOS,
  type DividendModelPresetPortfolio,
} from "./constants";

type AlphaHoldingRow = {
  symbol: string;
  sort_order: number;
  shares: number | null;
  avg_unit_cost: number | null;
};

export function scaleSharesForMultiplier(shares: number | null, multiplier: number): number | null {
  if (shares == null || !Number.isFinite(shares) || shares <= 0) return null;
  return shares * multiplier;
}

function alphaHoldings(db: Database.Database, alphaId: string): AlphaHoldingRow[] {
  return db
    .prepare(
      `SELECT symbol, sort_order, shares, avg_unit_cost FROM dividend_model_holdings WHERE portfolio_id = ? ORDER BY sort_order ASC`,
    )
    .all(alphaId) as AlphaHoldingRow[];
}

function syncTargetFromAlpha(
  db: Database.Database,
  alphaId: string,
  target: DividendModelPresetPortfolio,
  alphaRows: AlphaHoldingRow[],
): number {
  const alphaSymbols = new Set(alphaRows.map((h) => h.symbol.toUpperCase()));

  const targetRows = db
    .prepare(`SELECT id, symbol FROM dividend_model_holdings WHERE portfolio_id = ?`)
    .all(target.id) as Array<{ id: string; symbol: string }>;

  const del = db.prepare(`DELETE FROM dividend_model_holdings WHERE id = ?`);
  for (const row of targetRows) {
    if (!alphaSymbols.has(row.symbol.toUpperCase())) del.run(row.id);
  }

  const find = db.prepare(`SELECT id FROM dividend_model_holdings WHERE portfolio_id = ? AND symbol = ? COLLATE NOCASE`);
  const upd = db.prepare(
    `UPDATE dividend_model_holdings SET sort_order = ?, shares = ?, avg_unit_cost = ? WHERE id = ?`,
  );
  const ins = db.prepare(
    `INSERT INTO dividend_model_holdings (id, portfolio_id, symbol, sort_order, shares, avg_unit_cost) VALUES (?, ?, ?, ?, ?, ?)`,
  );

  let synced = 0;
  for (const h of alphaRows) {
    const sym = h.symbol.toUpperCase();
    const scaled = scaleSharesForMultiplier(h.shares, target.multiplier);
    const existing = find.get(target.id, sym) as { id: string } | undefined;
    if (existing) {
      upd.run(h.sort_order, scaled, h.avg_unit_cost, existing.id);
    } else {
      ins.run(newId("dmh"), target.id, sym, h.sort_order, scaled, h.avg_unit_cost);
    }
    synced += 1;
  }
  return synced;
}

export type SyncScaledSharesResult = {
  alphaId: string;
  targets: Array<{ portfolioId: string; name: string; multiplier: number; holdingsSynced: number }>;
};

/**
 * Mirrors alpha holdings into bravo (5×) and charlie (10×): upserts symbols, removes extras, scales shares.
 * Does not copy materialized monthly/sim rows — run Build history on each portfolio after syncing.
 */
function portfolioExists(db: Database.Database, id: string): boolean {
  return db.prepare(`SELECT 1 FROM dividend_model_portfolios WHERE id = ?`).get(id) != null;
}

export function syncScaledHoldingsFromAlpha(db: Database.Database): SyncScaledSharesResult {
  const alpha = DIVIDEND_MODEL_PRESET_PORTFOLIOS[0]!;
  if (alpha.id !== DEFAULT_DIVIDEND_MODEL_PORTFOLIO_ID) {
    throw new Error("Alpha preset misconfigured");
  }
  if (!portfolioExists(db, alpha.id)) {
    throw new Error("Alpha portfolio not found");
  }

  const alphaRows = alphaHoldings(db, alpha.id);
  const scaledPresets = DIVIDEND_MODEL_PRESET_PORTFOLIOS.filter((p) => p.multiplier > 1);
  for (const preset of scaledPresets) {
    if (!portfolioExists(db, preset.id)) {
      throw new Error(`Scaled portfolio not found: ${preset.name}`);
    }
  }

  const targets: SyncScaledSharesResult["targets"] = [];

  const tx = db.transaction(() => {
    for (const preset of scaledPresets) {
      const holdingsSynced = syncTargetFromAlpha(db, alpha.id, preset, alphaRows);
      targets.push({
        portfolioId: preset.id,
        name: preset.name,
        multiplier: preset.multiplier,
        holdingsSynced,
      });
    }
  });
  tx();

  return { alphaId: alpha.id, targets };
}

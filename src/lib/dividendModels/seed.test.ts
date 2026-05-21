import fs from "node:fs";
import path from "node:path";

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";

import {
  DEFAULT_DIVIDEND_MODEL_PORTFOLIO_ID,
  DIVIDEND_MODEL_PRESET_PORTFOLIOS,
} from "./constants";
import { ensurePresetDividendPortfolios } from "./seed";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  const schemaPath = path.join(process.cwd(), "src", "db", "schema.sql");
  db.exec(fs.readFileSync(schemaPath, "utf-8"));
  return db;
}

function holdingCount(db: Database.Database, portfolioId: string): number {
  const row = db
    .prepare(`SELECT COUNT(1) AS c FROM dividend_model_holdings WHERE portfolio_id = ?`)
    .get(portfolioId) as { c: number };
  return row?.c ?? 0;
}

describe("ensurePresetDividendPortfolios", () => {
  it("fresh DB creates three presets with 18 holdings each", () => {
    const db = createTestDb();
    ensurePresetDividendPortfolios(db);

    const ports = db
      .prepare(`SELECT id, name FROM dividend_model_portfolios ORDER BY id`)
      .all() as Array<{ id: string; name: string }>;
    assert.equal(ports.length, 3);

    for (const preset of DIVIDEND_MODEL_PRESET_PORTFOLIOS) {
      const row = ports.find((p) => p.id === preset.id);
      assert.ok(row, `missing preset ${preset.id}`);
      assert.equal(row!.name, preset.name);
      assert.equal(holdingCount(db, preset.id), 18);
    }
  });

  it("existing alpha only adds bravo and charlie with scaled shares", () => {
    const db = createTestDb();
    const alpha = DIVIDEND_MODEL_PRESET_PORTFOLIOS[0]!;
    db.prepare(
      `INSERT INTO dividend_model_portfolios (id, name, live_started_at, tracking_mode, meta_json) VALUES (?, ?, NULL, 'backtest', NULL)`,
    ).run(alpha.id, "Dividend model (default)");
    db.prepare(
      `INSERT INTO dividend_model_holdings (id, portfolio_id, symbol, sort_order, shares) VALUES ('h1', ?, 'SPY', 0, 10)`,
    ).run(alpha.id);
    db.prepare(
      `INSERT INTO dividend_model_holdings (id, portfolio_id, symbol, sort_order, shares) VALUES ('h2', ?, 'QQQ', 1, 2)`,
    ).run(alpha.id);

    ensurePresetDividendPortfolios(db);

    const bravo = DIVIDEND_MODEL_PRESET_PORTFOLIOS[1]!;
    const charlie = DIVIDEND_MODEL_PRESET_PORTFOLIOS[2]!;
    assert.equal(holdingCount(db, bravo.id), 2);
    assert.equal(holdingCount(db, charlie.id), 2);

    const bravoSpy = db
      .prepare(`SELECT shares FROM dividend_model_holdings WHERE portfolio_id = ? AND symbol = 'SPY'`)
      .get(bravo.id) as { shares: number };
    const charlieSpy = db
      .prepare(`SELECT shares FROM dividend_model_holdings WHERE portfolio_id = ? AND symbol = 'SPY'`)
      .get(charlie.id) as { shares: number };
    assert.equal(bravoSpy.shares, 50);
    assert.equal(charlieSpy.shares, 100);

    const alphaName = db
      .prepare(`SELECT name FROM dividend_model_portfolios WHERE id = ?`)
      .get(alpha.id) as { name: string };
    assert.equal(alphaName.name, alpha.name);
  });

  it("second call is idempotent", () => {
    const db = createTestDb();
    ensurePresetDividendPortfolios(db);
    ensurePresetDividendPortfolios(db);

    const count = db.prepare(`SELECT COUNT(1) AS c FROM dividend_model_portfolios`).get() as { c: number };
    assert.equal(count.c, 3);

    for (const preset of DIVIDEND_MODEL_PRESET_PORTFOLIOS) {
      assert.equal(holdingCount(db, preset.id), 18);
    }
  });

  it("does not overwrite bravo holdings when bravo already exists", () => {
    const db = createTestDb();
    ensurePresetDividendPortfolios(db);

    const bravo = DIVIDEND_MODEL_PRESET_PORTFOLIOS[1]!;
    db.prepare(`UPDATE dividend_model_holdings SET shares = 99 WHERE portfolio_id = ? AND symbol = 'PDI'`).run(
      bravo.id,
    );

    ensurePresetDividendPortfolios(db);

    const row = db
      .prepare(`SELECT shares FROM dividend_model_holdings WHERE portfolio_id = ? AND symbol = 'PDI'`)
      .get(bravo.id) as { shares: number };
    assert.equal(row.shares, 99);
  });
});

import fs from "node:fs";
import path from "node:path";

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";

import { DIVIDEND_MODEL_PRESET_PORTFOLIOS } from "./constants";
import { ensurePresetDividendPortfolios } from "./seed";
import { scaleSharesForMultiplier, syncScaledHoldingsFromAlpha } from "./syncScaledShares";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  const schemaPath = path.join(process.cwd(), "src", "db", "schema.sql");
  db.exec(fs.readFileSync(schemaPath, "utf-8"));
  return db;
}

describe("syncScaledHoldingsFromAlpha", () => {
  it("scaleSharesForMultiplier returns null for invalid shares", () => {
    assert.equal(scaleSharesForMultiplier(null, 5), null);
    assert.equal(scaleSharesForMultiplier(0, 5), null);
    assert.equal(scaleSharesForMultiplier(10, 5), 50);
  });

  it("updates bravo and charlie when alpha shares change", () => {
    const db = createTestDb();
    ensurePresetDividendPortfolios(db);

    const alpha = DIVIDEND_MODEL_PRESET_PORTFOLIOS[0]!;
    const bravo = DIVIDEND_MODEL_PRESET_PORTFOLIOS[1]!;
    const charlie = DIVIDEND_MODEL_PRESET_PORTFOLIOS[2]!;

    db.prepare(`UPDATE dividend_model_holdings SET shares = 4 WHERE portfolio_id = ? AND symbol = 'PDI'`).run(
      alpha.id,
    );

    const result = syncScaledHoldingsFromAlpha(db);
    assert.equal(result.targets.length, 2);

    const bravoPdi = db
      .prepare(`SELECT shares FROM dividend_model_holdings WHERE portfolio_id = ? AND symbol = 'PDI'`)
      .get(bravo.id) as { shares: number };
    const charliePdi = db
      .prepare(`SELECT shares FROM dividend_model_holdings WHERE portfolio_id = ? AND symbol = 'PDI'`)
      .get(charlie.id) as { shares: number };
    assert.equal(bravoPdi.shares, 20);
    assert.equal(charliePdi.shares, 40);
  });

  it("adds new alpha symbols and removes orphans on scaled portfolios", () => {
    const db = createTestDb();
    ensurePresetDividendPortfolios(db);

    const alpha = DIVIDEND_MODEL_PRESET_PORTFOLIOS[0]!;
    const bravo = DIVIDEND_MODEL_PRESET_PORTFOLIOS[1]!;

    db.prepare(
      `INSERT INTO dividend_model_holdings (id, portfolio_id, symbol, sort_order, shares) VALUES ('extra', ?, 'ZZZ', 99, 1)`,
    ).run(bravo.id);
    db.prepare(
      `INSERT INTO dividend_model_holdings (id, portfolio_id, symbol, sort_order, shares) VALUES ('newa', ?, 'NEW', 50, 3)`,
    ).run(alpha.id);

    syncScaledHoldingsFromAlpha(db);

    const orphan = db
      .prepare(`SELECT 1 FROM dividend_model_holdings WHERE portfolio_id = ? AND symbol = 'ZZZ'`)
      .get(bravo.id);
    assert.equal(orphan, undefined);

    const added = db
      .prepare(`SELECT shares FROM dividend_model_holdings WHERE portfolio_id = ? AND symbol = 'NEW'`)
      .get(bravo.id) as { shares: number };
    assert.equal(added.shares, 15);
  });
});

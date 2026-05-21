import fs from "node:fs";
import path from "node:path";

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";

import {
  DEFAULT_DIVIDEND_MODEL_PORTFOLIO_ID,
  DIVIDEND_MODEL_BASE_TARGET_NAV_USD,
  DIVIDEND_MODEL_PRESET_PORTFOLIOS,
  targetNavUsdForPortfolio,
} from "./constants";
import {
  buildMvWeights,
  computeSyntheticHoldingRows,
  loadSyntheticHoldings,
  persistSyntheticHoldingsForWindow,
} from "./syntheticHoldings";
import { anchorMonthEndForWindowYears, persistSymbolBacktestAnchors, readBacktestAnchorClose } from "./symbolBacktestAnchor";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  const schemaPath = path.join(process.cwd(), "src", "db", "schema.sql");
  db.exec(fs.readFileSync(schemaPath, "utf-8"));
  return db;
}

function seedSymbolMonthlyClose(db: Database.Database, symbol: string, close: number, now: Date): void {
  for (const wy of [1, 3, 5] as const) {
    const me = anchorMonthEndForWindowYears(now, wy);
    db.prepare(
      `
      INSERT INTO symbol_monthly_market
        (symbol, month_end, close_eom, dividend_per_share, annualized_yield_pct, price_source, dividend_source, computed_at)
      VALUES (?, ?, ?, 0, NULL, 'test', 'test', datetime('now'))
      ON CONFLICT(symbol, month_end) DO UPDATE SET close_eom = excluded.close_eom
    `,
    ).run(symbol, me, close);
  }
}

function navAtAnchor(
  db: Database.Database,
  portfolioId: string,
  windowYears: 1 | 3 | 5,
): number {
  const rows = db
    .prepare(
      `SELECT symbol, synthetic_shares FROM dividend_model_synthetic_holdings WHERE portfolio_id = ? AND window_years = ?`,
    )
    .all(portfolioId, windowYears) as Array<{ symbol: string; synthetic_shares: number }>;
  let nav = 0;
  for (const r of rows) {
    const close = readBacktestAnchorClose(db, r.symbol, windowYears);
    if (close != null) nav += r.synthetic_shares * close;
  }
  return nav;
}

describe("targetNavUsdForPortfolio", () => {
  it("uses 20k / 100k / 200k for presets", () => {
    assert.equal(targetNavUsdForPortfolio(DEFAULT_DIVIDEND_MODEL_PORTFOLIO_ID, 50_000), 20_000);
    assert.equal(targetNavUsdForPortfolio("dm_port_bravo", 50_000), 100_000);
    assert.equal(targetNavUsdForPortfolio("dm_port_charlie", 50_000), 200_000);
  });

  it("uses current MV for custom portfolios", () => {
    assert.equal(targetNavUsdForPortfolio("custom_port", 42_500), 42_500);
  });
});

describe("computeSyntheticHoldingRows", () => {
  it("MV weights sum to target NAV at anchor", () => {
    const anchorCloses = new Map([
      ["SPY", 100],
      ["QQQ", 50],
    ]);
    const enriched = [
      { symbol: "SPY", marketValue: 1000 },
      { symbol: "QQQ", marketValue: 500 },
    ];
    const rows = computeSyntheticHoldingRows(enriched, anchorCloses, "2021-05-31", 20_000);
    let nav = 0;
    let weightSum = 0;
    for (const r of rows) {
      nav += r.synthetic_shares * anchorCloses.get(r.symbol)!;
      weightSum += r.weight_pct / 100;
    }
    assert.equal(rows.length, 2);
    assert.ok(Math.abs(nav - 20_000) < 0.02);
    assert.ok(Math.abs(weightSum - 1) < 1e-9);
  });
});

describe("persistSyntheticHoldingsForWindow", () => {
  it("stores alpha/bravo/charlie targets near 20k/100k/200k", async () => {
    const db = createTestDb();
    const symbols = ["SPY", "QQQ"];
    for (const preset of DIVIDEND_MODEL_PRESET_PORTFOLIOS) {
      db.prepare(
        `INSERT INTO dividend_model_portfolios (id, name, live_started_at, tracking_mode, meta_json) VALUES (?, ?, NULL, 'backtest', NULL)`,
      ).run(preset.id, preset.name);
      for (const sym of symbols) {
        db.prepare(
          `INSERT INTO dividend_model_holdings (id, portfolio_id, symbol, sort_order, shares) VALUES (?, ?, ?, 0, 10)`,
        ).run(`${preset.id}-${sym}`, preset.id, sym);
        db.prepare(
          `INSERT INTO dividend_model_symbol_fundamentals_snap (id, symbol, captured_at, div_yield, raw_json, source)
           VALUES (?, ?, datetime('now'), 0.02, ?, 'test')`,
        ).run(`${preset.id}-snap-${sym}`, sym, JSON.stringify({ yahooChartPrice: sym === "SPY" ? 100 : 50 }));
      }
    }
    const now = new Date("2026-05-15T12:00:00Z");
    seedSymbolMonthlyClose(db, "SPY", 100, now);
    seedSymbolMonthlyClose(db, "QQQ", 50, now);
    persistSymbolBacktestAnchors(db, symbols, now);

    for (const preset of DIVIDEND_MODEL_PRESET_PORTFOLIOS) {
      const n = await persistSyntheticHoldingsForWindow(db, preset.id, 5, new Date("2026-05-15T12:00:00Z"));
      assert.equal(n, 2);
      const expected = DIVIDEND_MODEL_BASE_TARGET_NAV_USD * preset.multiplier;
      const nav = navAtAnchor(db, preset.id, 5);
      assert.ok(Math.abs(nav - expected) < 1, `${preset.id} nav ${nav} vs ${expected}`);
    }
  });

  it("re-persist replaces rows idempotently", async () => {
    const db = createTestDb();
    db.prepare(
      `INSERT INTO dividend_model_portfolios (id, name, live_started_at, tracking_mode, meta_json) VALUES (?, ?, NULL, 'backtest', NULL)`,
    ).run(DEFAULT_DIVIDEND_MODEL_PORTFOLIO_ID, "alpha");
    db.prepare(
      `INSERT INTO dividend_model_holdings (id, portfolio_id, symbol, sort_order, shares) VALUES ('h1', ?, 'SPY', 0, 5)`,
    ).run(DEFAULT_DIVIDEND_MODEL_PORTFOLIO_ID);
    db.prepare(
      `INSERT INTO dividend_model_symbol_fundamentals_snap (id, symbol, captured_at, div_yield, raw_json, source)
       VALUES ('s1', 'SPY', datetime('now'), 0.02, '{"yahooChartPrice":100}', 'test')`,
    ).run();
    const now = new Date("2026-05-15T12:00:00Z");
    seedSymbolMonthlyClose(db, "SPY", 100, now);
    persistSymbolBacktestAnchors(db, ["SPY"], now);
    await persistSyntheticHoldingsForWindow(db, DEFAULT_DIVIDEND_MODEL_PORTFOLIO_ID, 1, new Date("2026-05-15T12:00:00Z"));
    await persistSyntheticHoldingsForWindow(db, DEFAULT_DIVIDEND_MODEL_PORTFOLIO_ID, 1, new Date("2026-05-15T12:00:00Z"));
    const count = db
      .prepare(
        `SELECT COUNT(1) AS c FROM dividend_model_synthetic_holdings WHERE portfolio_id = ? AND window_years = 1`,
      )
      .get(DEFAULT_DIVIDEND_MODEL_PORTFOLIO_ID) as { c: number };
    assert.equal(count.c, 1);
    const holdings = loadSyntheticHoldings(db, DEFAULT_DIVIDEND_MODEL_PORTFOLIO_ID, 1);
    assert.equal(holdings.length, 1);
    assert.equal(holdings[0]!.symbol, "SPY");
  });
});

describe("buildMvWeights", () => {
  it("equal weight when no market values", () => {
    const anchorCloses = new Map([
      ["A", 10],
      ["B", 20],
    ]);
    const w = buildMvWeights(
      [
        { symbol: "A", marketValue: null },
        { symbol: "B", marketValue: null },
      ],
      anchorCloses,
    );
    assert.equal(w.get("A"), 0.5);
    assert.equal(w.get("B"), 0.5);
  });
});

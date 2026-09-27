import fs from "node:fs";
import path from "node:path";

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";

import type { SchwabTxnRaw } from "@/lib/schwab/transactionNormalize";
import {
  classifySchwabTradeRaw,
  effectiveStrategyCategory,
  reclassifyBrokerTransactionRow,
} from "@/lib/strategy/classifyTransaction";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  const schemaPath = path.join(process.cwd(), "src", "db", "schema.sql");
  db.exec(fs.readFileSync(schemaPath, "utf-8"));
  return db;
}

function occ(root: string, yymmdd: string, right: "C" | "P", strike: number): string {
  const padded = Math.round(strike * 1000).toString().padStart(8, "0");
  return `${root.padEnd(6, " ")}${yymmdd}${right}${padded}`;
}

function rawTrade(opts: {
  id: number;
  date: string;
  net?: number;
  legs: Array<{
    instruction: string;
    effect?: string;
    symbol: string;
    underlying: string;
    asset?: string;
    qty?: number;
    price?: number;
  }>;
}): SchwabTxnRaw {
  return {
    activityId: opts.id,
    tradeDate: opts.date,
    type: "TRADE",
    netAmount: opts.net ?? 0,
    transactionItem: opts.legs.map((leg) => ({
      instruction: leg.instruction,
      positionEffect: leg.effect ?? "OPENING",
      quantity: leg.qty ?? 1,
      price: leg.price ?? 1,
      instrument: {
        symbol: leg.symbol,
        underlyingSymbol: leg.underlying,
        assetType: leg.asset ?? "OPTION",
      },
    })),
  };
}

function seedAccount(db: Database.Database, accountId = "schwab_1") {
  db.prepare(
    `INSERT INTO institution_connections (id, type, display_name, status, created_at, updated_at)
     VALUES ('c1', 'schwab', 'Schwab', 'active', datetime('now'), datetime('now'))`,
  ).run();
  db.prepare(
    `INSERT INTO accounts (id, connection_id, name, type, currency, updated_at)
     VALUES (?, 'c1', 'Brokerage', 'MARGIN', 'USD', datetime('now'))`,
  ).run(accountId);
}

describe("classifySchwabTradeRaw taxonomy", () => {
  it("does not label a naked sell-open call as a covered call", () => {
    const db = createTestDb();
    seedAccount(db);
    const raw = rawTrade({
      id: 1,
      date: "2026-06-01",
      legs: [
        {
          instruction: "SELL_TO_OPEN",
          symbol: occ("AAPL", "260717", "C", 200),
          underlying: "AAPL",
        },
      ],
    });
    assert.equal(classifySchwabTradeRaw(db, raw, { accountId: "schwab_1" }), "naked-calls");
    assert.equal(classifySchwabTradeRaw(db, raw), "naked-calls");
  });

  it("does not relabel a historical naked call as covered after later share purchases", () => {
    const db = createTestDb();
    seedAccount(db);
    db.prepare(`INSERT INTO securities (id, symbol, name, security_type) VALUES ('s1', 'AAPL', 'Apple', 'equity')`).run();
    db.prepare(`INSERT INTO holding_snapshots (id, account_id, as_of) VALUES ('hs1', 'schwab_1', '2026-09-01T20:00:00Z')`).run();
    db.prepare(
      `INSERT INTO positions (id, snapshot_id, security_id, quantity, price, market_value) VALUES ('p1', 'hs1', 's1', 100, 220, 22000)`,
    ).run();
    const raw = rawTrade({
      id: 11,
      date: "2026-01-20",
      legs: [
        {
          instruction: "SELL_TO_OPEN",
          symbol: occ("AAPL", "260320", "C", 200),
          underlying: "AAPL",
        },
      ],
    });
    assert.equal(classifySchwabTradeRaw(db, raw, { accountId: "schwab_1" }), "naked-calls");
  });

  it("labels a sell-open call covered when long shares exist", () => {
    const db = createTestDb();
    seedAccount(db);
    db.prepare(`INSERT INTO securities (id, symbol, name, security_type) VALUES ('s1', 'AAPL', 'Apple', 'equity')`).run();
    db.prepare(`INSERT INTO holding_snapshots (id, account_id, as_of) VALUES ('hs1', 'schwab_1', '2026-06-01T16:00:00Z')`).run();
    db.prepare(
      `INSERT INTO positions (id, snapshot_id, security_id, quantity, price, market_value) VALUES ('p1', 'hs1', 's1', 100, 190, 19000)`,
    ).run();
    const raw = rawTrade({
      id: 2,
      date: "2026-06-01",
      legs: [
        {
          instruction: "SELL_TO_OPEN",
          symbol: occ("AAPL", "260717", "C", 200),
          underlying: "AAPL",
        },
      ],
    });
    assert.equal(classifySchwabTradeRaw(db, raw, { accountId: "schwab_1" }), "covered-calls");
  });

  it("keeps short puts in options-sales and LEAP buys in leaps", () => {
    const db = createTestDb();
    seedAccount(db);
    const put = rawTrade({
      id: 3,
      date: "2026-06-01",
      legs: [{ instruction: "SELL_TO_OPEN", symbol: occ("IWM", "260717", "P", 180), underlying: "IWM" }],
    });
    const leap = rawTrade({
      id: 4,
      date: "2026-06-01",
      legs: [{ instruction: "BUY_TO_OPEN", symbol: occ("TSLA", "280121", "C", 400), underlying: "TSLA" }],
    });
    assert.equal(classifySchwabTradeRaw(db, put, { accountId: "schwab_1" }), "options-sales");
    assert.equal(classifySchwabTradeRaw(db, leap, { accountId: "schwab_1" }), "leaps");
  });

  it("does not dump short-DTE buy calls into options-sales", () => {
    const db = createTestDb();
    seedAccount(db);
    const raw = rawTrade({
      id: 5,
      date: "2026-06-01",
      legs: [{ instruction: "BUY_TO_OPEN", symbol: occ("NVDA", "260620", "C", 140), underlying: "NVDA" }],
    });
    assert.equal(classifySchwabTradeRaw(db, raw, { accountId: "schwab_1" }), "long-calls");
  });

  it("classifies a same-activity short strangle and a 1-2-1 butterfly", () => {
    const db = createTestDb();
    seedAccount(db);
    const strangle = rawTrade({
      id: 6,
      date: "2026-06-01",
      legs: [
        { instruction: "SELL_TO_OPEN", symbol: occ("IWM", "260717", "P", 180), underlying: "IWM" },
        { instruction: "SELL_TO_OPEN", symbol: occ("IWM", "260717", "C", 230), underlying: "IWM" },
      ],
    });
    const fly = rawTrade({
      id: 7,
      date: "2026-06-01",
      legs: [
        { instruction: "BUY_TO_OPEN", symbol: occ("SPY", "260717", "C", 500), underlying: "SPY", qty: 1 },
        { instruction: "SELL_TO_OPEN", symbol: occ("SPY", "260717", "C", 520), underlying: "SPY", qty: 2 },
        { instruction: "BUY_TO_OPEN", symbol: occ("SPY", "260717", "C", 540), underlying: "SPY", qty: 1 },
      ],
    });
    assert.equal(classifySchwabTradeRaw(db, strangle, { accountId: "schwab_1" }), "short-strangles");
    assert.equal(classifySchwabTradeRaw(db, fly, { accountId: "schwab_1" }), "butterflies");
  });

  it("dual-reads a legacy covered-calls label as naked when uncovered", () => {
    const db = createTestDb();
    seedAccount(db);
    const raw = rawTrade({
      id: 8,
      date: "2026-06-01",
      legs: [{ instruction: "SELL_TO_OPEN", symbol: occ("AAPL", "260717", "C", 200), underlying: "AAPL" }],
    });
    assert.equal(
      effectiveStrategyCategory(db, {
        accountId: "schwab_1",
        rawJson: JSON.stringify(raw),
        storedCategory: "covered-calls",
      }),
      "naked-calls",
    );
    assert.equal(
      effectiveStrategyCategory(db, {
        accountId: "schwab_1",
        rawJson: JSON.stringify(
          rawTrade({
            id: 9,
            date: "2026-06-01",
            legs: [{ instruction: "BUY_TO_OPEN", symbol: occ("NVDA", "260620", "C", 140), underlying: "NVDA" }],
          }),
        ),
        storedCategory: "options-sales",
      }),
      "long-calls",
    );
  });

  it("writes the new slug and preserves the original on reclassify", () => {
    const db = createTestDb();
    seedAccount(db);
    const raw = rawTrade({
      id: 10,
      date: "2026-06-01",
      legs: [{ instruction: "SELL_TO_OPEN", symbol: occ("AAPL", "260717", "C", 200), underlying: "AAPL" }],
    });
    db.prepare(
      `INSERT INTO broker_transactions (
        id, account_id, external_activity_id, trade_date, raw_json, asset_type, instruction,
        strategy_category, updated_at
      ) VALUES ('btx1', 'schwab_1', '10', '2026-06-01', ?, 'OPTION', 'SELL_TO_OPEN', 'covered-calls', datetime('now'))`,
    ).run(JSON.stringify(raw));
    assert.equal(reclassifyBrokerTransactionRow(db, "btx1"), "naked-calls");
    const row = db
      .prepare(`SELECT strategy_category, strategy_category_original FROM broker_transactions WHERE id = 'btx1'`)
      .get() as { strategy_category: string; strategy_category_original: string };
    assert.equal(row.strategy_category, "naked-calls");
    assert.equal(row.strategy_category_original, "covered-calls");
  });
});

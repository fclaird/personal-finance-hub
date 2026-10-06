import fs from "node:fs";
import path from "node:path";

import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";

import {
  computePeriodPlFromSeries,
  computePeriodPct,
  computeVsBenchmark,
  fifoRealizedForClosingLeg,
  loadRealizedTrades,
  parseRealizedGainFromRaw,
  periodPlTitle,
  realizedGainScopeForNickname,
} from "@/lib/analytics/periodReport";
import type { SchwabTxnItem, SchwabTxnRaw } from "@/lib/schwab/transactionNormalize";

test("computePeriodPlFromSeries uses anchor day and subtracts session cash flow", () => {
  const series = [
    { asOf: "2026-08-28T20:00:00.000Z", totalMarketValue: 1_000_000 },
    { asOf: "2026-08-31T20:00:00.000Z", totalMarketValue: 1_010_000 },
  ];
  const out = computePeriodPlFromSeries(series, "2026-08-28", "2026-08-31", 5_000);
  assert.equal(out.startValue, 1_000_000);
  assert.equal(out.endValue, 1_010_000);
  assert.equal(out.plDollars, 5_000);
  assert.equal(out.plPct, 0.5);
  assert.deepEqual(out.baseline, { kind: "period" });
  assert.equal(periodPlTitle(out.baseline, "2026-08-31"), "Period P&L");
});

test("computePeriodPlFromSeries labels a gap with the last print instead of the period", () => {
  const series = [
    { asOf: "2026-09-30T16:56:00.000Z", totalMarketValue: 5_090_000 },
    { asOf: "2026-10-06T13:21:00.000Z", totalMarketValue: 5_669_000 },
  ];
  const out = computePeriodPlFromSeries(series, "2026-10-02", "2026-10-06");
  assert.equal(out.startValue, 5_090_000);
  assert.equal(out.endValue, 5_669_000);
  assert.deepEqual(out.baseline, { kind: "since", baselineYmd: "2026-09-30" });
  assert.equal(periodPlTitle(out.baseline, "2026-10-06"), "since Sep 30");
});

test("periodPlTitle includes the year when the last print is in a prior year", () => {
  assert.equal(periodPlTitle({ kind: "since", baselineYmd: "2025-12-31" }, "2026-01-02"), "since Dec 31, 2025");
});

test("computePeriodPct and vs benchmark arithmetic", () => {
  assert.equal(computePeriodPct(100, 110), 10);
  assert.equal(computeVsBenchmark(2.5, 1.0), 1.5);
  assert.equal(computeVsBenchmark(null, 1.0), null);
});

test("parseRealizedGainFromRaw prefers top-level gainLoss", () => {
  const raw = { gainLoss: 125.5, transactionItem: [] } as SchwabTxnRaw;
  assert.equal(parseRealizedGainFromRaw(raw), 125.5);
});

test("parseRealizedGainFromRaw ignores OPENING legs without gainLoss", () => {
  const raw: SchwabTxnRaw = {
    type: "TRADE",
    transactionItem: [
      {
        positionEffect: "OPENING",
        price: 10,
        quantity: 100,
        cost: -1000,
        instrument: { assetType: "EQUITY", symbol: "AAPL" },
      },
    ],
  };
  assert.equal(parseRealizedGainFromRaw(raw), null);
});

test("fifoRealizedForClosingLeg matches long equity round trip", () => {
  const lots = [{ qty: 100, perUnit: 10 }];
  const { gain, complete } = fifoRealizedForClosingLeg(lots, -100, 12);
  assert.equal(complete, true);
  assert.equal(gain, 200);
  assert.equal(lots.length, 0);
});

test("fifoRealizedForClosingLeg second round-trip uses the new lot not leftover qty", () => {
  const lots = [{ qty: 100, perUnit: 10 }];
  const first = fifoRealizedForClosingLeg(lots, -100, 12);
  assert.equal(first.complete, true);
  assert.equal(first.gain, 200);
  lots.push({ qty: 100, perUnit: 15 });
  const second = fifoRealizedForClosingLeg(lots, -100, 16);
  assert.equal(second.complete, true);
  assert.equal(second.gain, 100);
  assert.equal(lots.length, 0);
});

test("fifoRealizedForClosingLeg matches short option close", () => {
  const lots = [{ qty: -7, perUnit: 770 }];
  const { gain, complete } = fifoRealizedForClosingLeg(lots, 7, 124);
  assert.equal(complete, true);
  assert.equal(gain, 4522);
  assert.equal(lots.length, 0);
});

test("fifoRealizedForClosingLeg is incomplete without opening lot", () => {
  const { gain, complete } = fifoRealizedForClosingLeg([], 7, 124);
  assert.equal(complete, false);
  assert.equal(gain, 0);
});

test("realizedGainScopeForNickname maps joint_brokerage vs retirement", () => {
  assert.equal(realizedGainScopeForNickname("joint_brokerage"), "joint_brokerage");
  assert.equal(realizedGainScopeForNickname("Joint_Brokerage"), "joint_brokerage");
  assert.equal(realizedGainScopeForNickname("c_roth-IRA"), "retirement");
  assert.equal(realizedGainScopeForNickname(null), "retirement");
});

function equityTradeRaw(leg: SchwabTxnItem): string {
  return JSON.stringify({ type: "TRADE", transactionItem: [leg] } satisfies SchwabTxnRaw);
}

test("loadRealizedTrades consumes out-of-window closes so later round-trips use the new lots", () => {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(path.join(process.cwd(), "src", "db", "schema.sql"), "utf-8"));
  db.prepare(
    `INSERT INTO institution_connections (id, type, display_name, status) VALUES ('conn1', 'schwab', 'Schwab', 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO accounts (id, connection_id, name, nickname, account_bucket, type)
     VALUES ('schwab_1', 'conn1', 'Brokerage', 'joint_brokerage', 'brokerage', 'brokerage')`,
  ).run();
  const insert = db.prepare(
    `INSERT INTO broker_transactions (
       id, account_id, external_activity_id, trade_date, transaction_type, raw_json, symbol,
       asset_type, position_effect, quantity, price, leg_count
     ) VALUES (?, 'schwab_1', ?, ?, 'TRADE', ?, 'AAPL', 'EQUITY', ?, ?, ?, 1)`,
  );
  insert.run(
    "tx_open_old",
    "ext_open_old",
    "2026-08-03",
    equityTradeRaw({
      positionEffect: "OPENING",
      quantity: 100,
      cost: -1000,
      instrument: { assetType: "EQUITY", symbol: "AAPL" },
    }),
    "OPENING",
    100,
    10,
  );
  insert.run(
    "tx_close_old",
    "ext_close_old",
    "2026-08-04",
    equityTradeRaw({
      positionEffect: "CLOSING",
      quantity: -100,
      cost: 1200,
      instrument: { assetType: "EQUITY", symbol: "AAPL" },
    }),
    "CLOSING",
    -100,
    12,
  );
  insert.run(
    "tx_open_new",
    "ext_open_new",
    "2026-08-10",
    equityTradeRaw({
      positionEffect: "OPENING",
      quantity: 100,
      cost: -1500,
      instrument: { assetType: "EQUITY", symbol: "AAPL" },
    }),
    "OPENING",
    100,
    15,
  );
  insert.run(
    "tx_close_new",
    "ext_close_new",
    "2026-08-11",
    equityTradeRaw({
      positionEffect: "CLOSING",
      quantity: -100,
      cost: 1600,
      instrument: { assetType: "EQUITY", symbol: "AAPL" },
    }),
    "CLOSING",
    -100,
    16,
  );

  const { trades } = loadRealizedTrades(db, "main", "2026-08-10", "2026-08-11");
  const close = trades.find((t) => t.id === "tx_close_new:AAPL");
  assert.equal(close?.realizedDollars, 100);
  assert.equal(close?.tradedAt, null);
});

test("loadRealizedTrades keeps the broker clock time without changing gainLoss dollars", () => {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(path.join(process.cwd(), "src", "db", "schema.sql"), "utf-8"));
  db.prepare(
    `INSERT INTO institution_connections (id, type, display_name, status) VALUES ('conn1', 'schwab', 'Schwab', 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO accounts (id, connection_id, name, nickname, account_bucket, type)
     VALUES ('schwab_1', 'conn1', 'Brokerage', 'joint_brokerage', 'brokerage', 'brokerage')`,
  ).run();
  const raw = JSON.stringify({
    type: "TRADE",
    gainLoss: 42.5,
    tradeDate: "2026-10-04",
    time: "2026-10-04T22:30:00.000Z",
  });
  db.prepare(
    `INSERT INTO broker_transactions (
       id, account_id, external_activity_id, trade_date, transaction_type, raw_json, symbol, leg_count
     ) VALUES ('tx_sun', 'schwab_1', 'ext_sun', '2026-10-04', 'TRADE', ?, 'ES', 1)`,
  ).run(raw);

  const { trades } = loadRealizedTrades(db, "main", "2026-10-04", "2026-10-05");
  assert.equal(trades.length, 1);
  assert.equal(trades[0]!.realizedDollars, 42.5);
  assert.equal(trades[0]!.tradedAt, "2026-10-04T22:30:00.000Z");
  assert.equal(trades[0]!.tradeDate, "2026-10-04");
});

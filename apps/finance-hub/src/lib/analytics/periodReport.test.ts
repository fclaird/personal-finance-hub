import assert from "node:assert/strict";
import test from "node:test";

import {
  computePeriodPlFromSeries,
  computePeriodPct,
  computeVsBenchmark,
  fifoRealizedForClosingLeg,
  parseRealizedGainFromRaw,
  realizedGainScopeForNickname,
} from "@/lib/analytics/periodReport";
import type { SchwabTxnRaw } from "@/lib/schwab/transactionNormalize";

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
});

test("fifoRealizedForClosingLeg matches short option close", () => {
  const lots = [{ qty: -7, perUnit: 770 }];
  const { gain, complete } = fifoRealizedForClosingLeg(lots, 7, 124);
  assert.equal(complete, true);
  assert.equal(gain, 4522);
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

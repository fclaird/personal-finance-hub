import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFundStatementBasis,
  markToMarketFund,
  publicNavTimesQtyMismatch,
  repairFundBasisIfMarkDrift,
  yahooCloseOnOrBefore,
} from "./planFundPricing";

test("markToMarketFund scales statement balance by public fund return", () => {
  const basis = { statementMarketValue: 194_528, statementDate: "2026-05-01", basisTickerNav: 354 };
  assert.equal(markToMarketFund(basis, 368.58), 194_528 * (368.58 / 354));
});

test("repairFundBasisIfMarkDrift fixes purchase-date anchor that inflates mark-to-market", () => {
  const basis = { statementMarketValue: 194_528, statementDate: "2011-09-27", basisTickerNav: 120 };
  const repaired = repairFundBasisIfMarkDrift(basis, 368.58, 1618);
  assert.ok(repaired);
  assert.equal(repaired!.basisTickerNav, 368.58);
  assert.equal(markToMarketFund(repaired!, 368.58), 194_528);
});

test("repairFundBasisIfMarkDrift fixes Yahoo-fallback basisTickerNav=1 even when qty matches statement", () => {
  const basis = { statementMarketValue: 194_528, statementDate: "2026-05-01", basisTickerNav: 1 };
  const qty = 194_528 / 368.58;
  const repaired = repairFundBasisIfMarkDrift(basis, 368.58, qty);
  assert.ok(repaired);
  assert.equal(markToMarketFund(repaired!, 368.58), 194_528);
});

test("buildFundStatementBasis returns null when NAV cannot be fetched", async () => {
  const basis = await buildFundStatementBasis("__no_such_ticker_xyz__", 10_000, "2026-05-01");
  assert.equal(basis, null);
});

test("publicNavTimesQtyMismatch detects 529 plan vs public NAV divergence", () => {
  assert.equal(publicNavTimesQtyMismatch(1618, 194_528, 368.58), true);
  assert.equal(publicNavTimesQtyMismatch(100, 36_858, 368.58), false);
});

test("yahooCloseOnOrBefore picks last bar on or before target date", () => {
  const result = {
    timestamp: [
      new Date("2026-05-01T00:00:00Z").getTime() / 1000,
      new Date("2026-05-05T00:00:00Z").getTime() / 1000,
    ],
    indicators: { quote: [{ close: [350, 355] }] },
  };
  assert.equal(yahooCloseOnOrBefore(result, "2026-05-06"), 355);
  assert.equal(yahooCloseOnOrBefore(result, "2026-05-03"), 350);
});

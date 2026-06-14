import assert from "node:assert/strict";
import test from "node:test";

import {
  fundStatementBasisFromNav,
  markToMarketFund,
  publicNavTimesQtyMismatch,
  yahooCloseOnOrBefore,
} from "./planFundPricing";

test("markToMarketFund scales statement balance by public fund return", () => {
  const basis = { statementMarketValue: 194_528, statementDate: "2026-05-01", basisTickerNav: 354 };
  assert.equal(markToMarketFund(basis, 368.58), 194_528 * (368.58 / 354));
});

test("fundStatementBasisFromNav fails closed without a positive public NAV", () => {
  assert.equal(fundStatementBasisFromNav(194_528, "2026-05-01", null), null);
  assert.equal(fundStatementBasisFromNav(194_528, "2026-05-01", 0), null);
  assert.equal(fundStatementBasisFromNav(194_528, "2026-05-01", Number.NaN), null);

  assert.deepEqual(fundStatementBasisFromNav(194_528, "2026-05-01", 354), {
    statementMarketValue: 194_528,
    statementDate: "2026-05-01",
    basisTickerNav: 354,
  });
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

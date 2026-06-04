import assert from "node:assert/strict";
import test from "node:test";

import {
  markToMarketFund,
  publicNavTimesQtyMismatch,
  repairFundBasisIfMarkDrift,
  resolveFundStatementNav,
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

test("resolveFundStatementNav fails closed when no valid NAV is available", () => {
  assert.equal(resolveFundStatementNav("VTHRX", null, 368.58), 368.58);
  assert.throws(
    () => resolveFundStatementNav("VTHRX", null, null),
    /Unable to fetch a valid NAV/,
  );
  assert.throws(
    () => resolveFundStatementNav("VTHRX", 0, 368.58),
    /Unable to fetch a valid NAV/,
  );
});

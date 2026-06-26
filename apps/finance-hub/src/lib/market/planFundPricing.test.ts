import assert from "node:assert/strict";
import test from "node:test";

import {
  fundStatementBasisFromNav,
  markToMarketFund,
  yahooCloseOnOrBefore,
} from "./planFundPricing";

test("markToMarketFund scales statement balance by public fund return", () => {
  const basis = { statementMarketValue: 194_528, statementDate: "2026-05-01", basisTickerNav: 354 };
  assert.equal(markToMarketFund(basis, 368.58), 194_528 * (368.58 / 354));
});

test("fundStatementBasisFromNav fails closed without a valid NAV", () => {
  assert.equal(fundStatementBasisFromNav(50_000, "2026-06-01", null), null);
  assert.equal(fundStatementBasisFromNav(50_000, "2026-06-01", 0), null);
  assert.equal(fundStatementBasisFromNav(50_000, "2026-06-01", Number.NaN), null);
  assert.deepEqual(fundStatementBasisFromNav(50_000, "2026-06-01", 368.58), {
    statementMarketValue: 50_000,
    statementDate: "2026-06-01",
    basisTickerNav: 368.58,
  });
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

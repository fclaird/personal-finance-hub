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

test("markToMarketFund preserves legitimate plan-fund gains above the original statement balance", () => {
  const basis = { statementMarketValue: 100_000, statementDate: "2026-05-01", basisTickerNav: 100 };
  assert.equal(markToMarketFund(basis, 113), 113_000);
});

test("fundStatementBasisFromNav fails closed when Yahoo NAV is unavailable", () => {
  assert.equal(fundStatementBasisFromNav(100_000, "2026-05-01", null), null);
  assert.equal(fundStatementBasisFromNav(100_000, "2026-05-01", 0), null);
  assert.deepEqual(fundStatementBasisFromNav(100_000, "2026-05-01", 101.25), {
    statementMarketValue: 100_000,
    statementDate: "2026-05-01",
    basisTickerNav: 101.25,
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

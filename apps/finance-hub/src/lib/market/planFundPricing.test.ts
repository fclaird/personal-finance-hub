import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFundStatementBasis,
  markToMarketFund,
  yahooCloseOnOrBefore,
} from "./planFundPricing";

test("markToMarketFund scales statement balance by public fund return", () => {
  const basis = { statementMarketValue: 194_528, statementDate: "2026-05-01", basisTickerNav: 354 };
  assert.equal(markToMarketFund(basis, 368.58), 194_528 * (368.58 / 354));
});

test("markToMarketFund preserves legitimate statement-anchored gains", () => {
  const basis = { statementMarketValue: 100_000, statementDate: "2025-06-01", basisTickerNav: 100 };
  assert.equal(markToMarketFund(basis, 130), 130_000);
});

test("buildFundStatementBasis fails closed when Yahoo cannot provide a real NAV", async () => {
  const basis = await buildFundStatementBasis("MUTFUND", 25_000, "2026-06-01", {
    fetchNavOnDate: async () => null,
    fetchLatestPrice: async () => null,
  });

  assert.equal(basis, null);
});

test("buildFundStatementBasis uses latest price fallback only when it is real", async () => {
  const basis = await buildFundStatementBasis("MUTFUND", 25_000, "2026-06-01", {
    fetchNavOnDate: async () => null,
    fetchLatestPrice: async () => 42,
  });

  assert.deepEqual(basis, {
    statementMarketValue: 25_000,
    statementDate: "2026-06-01",
    basisTickerNav: 42,
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

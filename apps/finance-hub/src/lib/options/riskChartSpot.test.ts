import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  bestAvailableSpotFromSchwabEntry,
  bestAvailableSpotFromYahooMeta,
  resolveRiskChartSpot,
  samePrint,
} from "@/lib/options/riskChartSpot";

describe("bestAvailableSpotFromSchwabEntry", () => {
  it("when cash is closed, prefers extended last over quote last/close for any symbol", () => {
    const entry = {
      quote: { lastPrice: 223.05, closePrice: 223.05, mark: 223.05 },
      regular: { regularMarketLastPrice: 223.05 },
      extended: { lastPrice: 245.2, mark: 245.15 },
    };
    const got = bestAvailableSpotFromSchwabEntry(entry, false);
    assert.equal(got.spot, 245.2);
    assert.equal(got.source, "schwab-extended");
    assert.equal(got.close, 223.05);
  });

  it("when cash is closed and extended is missing, uses quote last if it is not the cash close", () => {
    const entry = {
      quote: { lastPrice: 245.2, closePrice: 223.05, mark: 245.18 },
      regular: { regularMarketLastPrice: 223.05 },
    };
    const got = bestAvailableSpotFromSchwabEntry(entry, false);
    assert.equal(got.source, "schwab-quote");
    assert.equal(got.spot, 245.2);
  });

  it("when cash is closed and last equals close, labels the print as cash close", () => {
    const entry = {
      quote: { lastPrice: 223.05, closePrice: 223.05, mark: 223.05 },
      regular: { regularMarketLastPrice: 223.05 },
    };
    const got = bestAvailableSpotFromSchwabEntry(entry, false);
    assert.equal(got.spot, 223.05);
    assert.equal(got.source, "schwab-close");
  });

  it("when cash is open, prefers quote last over leftover extended premarket", () => {
    const entry = {
      quote: { lastPrice: 246.1, closePrice: 223.05, mark: 246.1 },
      regular: { regularMarketLastPrice: 246.1 },
      extended: { lastPrice: 244.8, mark: 244.8 },
    };
    const got = bestAvailableSpotFromSchwabEntry(entry, true);
    assert.equal(got.spot, 246.1);
    assert.equal(got.source, "schwab-quote");
  });

  it("reads extended from a flattened Schwab entry", () => {
    const entry = {
      lastPrice: 223.05,
      closePrice: 223.05,
      mark: 223.05,
      extended: { lastPrice: 245.4, mark: 245.4 },
    };
    const got = bestAvailableSpotFromSchwabEntry(entry, false);
    assert.equal(got.spot, 245.4);
    assert.equal(got.source, "schwab-extended");
  });
});

describe("bestAvailableSpotFromYahooMeta", () => {
  it("when cash is closed, prefers postMarketPrice over regularMarketPrice", () => {
    assert.equal(
      bestAvailableSpotFromYahooMeta(
        { regularMarketPrice: 223.05, postMarketPrice: 245.2, preMarketPrice: 240 },
        false,
      ),
      245.2,
    );
  });

  it("when cash is closed, uses preMarketPrice if post is missing", () => {
    assert.equal(
      bestAvailableSpotFromYahooMeta({ regularMarketPrice: 223.05, preMarketPrice: 241.3 }, false),
      241.3,
    );
  });

  it("when cash is open, prefers regularMarketPrice", () => {
    assert.equal(
      bestAvailableSpotFromYahooMeta(
        { regularMarketPrice: 246.1, postMarketPrice: 245.2, preMarketPrice: 240 },
        true,
      ),
      246.1,
    );
  });
});

describe("resolveRiskChartSpot", () => {
  it("live quote wins over OHLCV/book fallback", () => {
    assert.equal(resolveRiskChartSpot(245.2, 223.05), 245.2);
  });

  it("falls back to book/OHLCV spot when live is missing", () => {
    assert.equal(resolveRiskChartSpot(null, 223.05), 223.05);
    assert.equal(resolveRiskChartSpot(undefined, 223.05), 223.05);
  });
});

describe("samePrint", () => {
  it("treats last equal to close as the same cash print", () => {
    assert.equal(samePrint(223.05, 223.05), true);
    assert.equal(samePrint(223.05, 245.2), false);
  });
});

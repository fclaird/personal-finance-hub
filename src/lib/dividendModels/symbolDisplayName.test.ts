import assert from "node:assert/strict";
import test from "node:test";

import { extractYahooLongNameFromChartResult } from "./symbolDisplayName";

test("extractYahooLongNameFromChartResult prefers longName over shortName", () => {
  const name = extractYahooLongNameFromChartResult({
    meta: { longName: "NEOS Nasdaq 100 High Income ETF", shortName: "QQQI" },
  });
  assert.equal(name, "NEOS Nasdaq 100 High Income ETF");
});

test("extractYahooLongNameFromChartResult falls back to shortName", () => {
  const name = extractYahooLongNameFromChartResult({
    meta: { shortName: "Schwab US Dividend Equity ETF" },
  });
  assert.equal(name, "Schwab US Dividend Equity ETF");
});

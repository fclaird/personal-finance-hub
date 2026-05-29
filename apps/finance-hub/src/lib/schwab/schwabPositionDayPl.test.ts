import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateUnderlyingDayPlFromPositions,
  schwabCurrentDayProfitLoss,
  underlyingKeyForDayPl,
} from "@/lib/schwab/schwabPositionDayPl";

test("schwabCurrentDayProfitLoss reads camelCase field", () => {
  const meta = JSON.stringify({ currentDayProfitLoss: -125.5 });
  assert.equal(schwabCurrentDayProfitLoss(meta), -125.5);
});

test("aggregateUnderlyingDayPlFromPositions sums equity and options on underlying", () => {
  const positions = [
    {
      symbol: "NVDA",
      securityType: "equity",
      metadataJson: JSON.stringify({ currentDayProfitLoss: 100 }),
    },
    {
      symbol: "NVDA  260620C00150000",
      securityType: "option",
      underlyingSymbol: "NVDA",
      effectiveUnderlyingSymbol: "NVDA",
      metadataJson: JSON.stringify({ currentDayProfitLoss: -40 }),
    },
    {
      symbol: "AAPL",
      securityType: "equity",
      metadataJson: JSON.stringify({ currentDayProfitLoss: 50 }),
    },
  ];
  const m = aggregateUnderlyingDayPlFromPositions(positions);
  assert.equal(m.get("NVDA"), 60);
  assert.equal(m.get("AAPL"), 50);
});

test("underlyingKeyForDayPl uses option underlying", () => {
  assert.equal(
    underlyingKeyForDayPl({
      symbol: "TSLA  260619C00260000",
      securityType: "option",
      underlyingSymbol: "TSLA",
    }),
    "TSLA",
  );
});

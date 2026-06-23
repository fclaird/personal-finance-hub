import assert from "node:assert/strict";
import test from "node:test";

import {
  applyEquityMarkToExposureRow,
  exposureBucketSymbolKey,
  type ExposureRow,
} from "@/lib/analytics/optionsExposure";

function exposureRow(overrides: Partial<ExposureRow> = {}): ExposureRow {
  return {
    underlyingSymbol: "VTI",
    spotMarketValue: 0,
    heldShares: 0,
    syntheticMarketValue: 0,
    syntheticShares: 0,
    optionsMarkMarketValue: 0,
    ...overrides,
  };
}

test("plan-fund spot anchoring is scoped by bucket and does not suppress option exposure", () => {
  const anchored = new Set([exposureBucketSymbolKey("529", "VTI")]);
  const planFundRow = exposureRow({ spotMarketValue: 50_000, heldShares: 500 });
  const brokerageOptionRow = exposureRow({ syntheticShares: 120 });

  applyEquityMarkToExposureRow("529", planFundRow, 300, anchored);
  applyEquityMarkToExposureRow("brokerage", brokerageOptionRow, 300, anchored);

  assert.equal(planFundRow.spotMarketValue, 50_000);
  assert.equal(planFundRow.syntheticMarketValue, 0);
  assert.equal(brokerageOptionRow.syntheticMarketValue, 36_000);
});

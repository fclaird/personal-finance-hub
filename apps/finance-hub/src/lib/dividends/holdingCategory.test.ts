import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { inferHoldingCategory, isSchwabFundLike } from "./holdingCategory";

describe("holdingCategory", () => {
  it("isSchwabFundLike detects mutual funds and ETFs", () => {
    assert.equal(isSchwabFundLike("other", "MUTUAL_FUND"), true);
    assert.equal(isSchwabFundLike("fund", null), true);
    assert.equal(isSchwabFundLike("equity", "EQUITY"), false);
  });

  it("inferHoldingCategory uses Schwab asset type before ticker heuristics", () => {
    assert.equal(inferHoldingCategory("FWADX", null, null, { securityType: "other", assetType: "MUTUAL_FUND" }), "Mutual Funds");
    assert.equal(inferHoldingCategory("SCHD", null, null, { securityType: "fund", assetType: "ETF" }), "ETFs");
    assert.equal(inferHoldingCategory("AAPL", "Technology", null, { securityType: "equity", assetType: "EQUITY" }), "Technology");
  });
});

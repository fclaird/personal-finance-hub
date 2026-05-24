import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { classifyAsset } from "./assetClass";

describe("classifyAsset", () => {
  it("maps security_type fund directly (manual holdings)", () => {
    assert.equal(classifyAsset("fund", JSON.stringify({ source: "manual" })), "fund");
  });

  it("maps security_type equity and cash", () => {
    assert.equal(classifyAsset("equity", null), "equity");
    assert.equal(classifyAsset("cash", null), "cash");
  });

  it("falls back to Schwab instrument metadata", () => {
    assert.equal(
      classifyAsset("other", JSON.stringify({ instrument: { assetType: "MUTUAL_FUND" } })),
      "fund",
    );
  });
});

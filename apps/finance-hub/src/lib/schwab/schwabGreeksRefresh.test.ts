import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { shouldApplyGreeksFromSchwabQuote } from "./schwabGreeksRefresh";

describe("shouldApplyGreeksFromSchwabQuote", () => {
  it("always applies during RTH", () => {
    assert.equal(shouldApplyGreeksFromSchwabQuote({}, true), true);
    assert.equal(shouldApplyGreeksFromSchwabQuote({ delta: 0 }, true), true);
  });

  it("skips empty after-hours quotes so stored deltas are preserved", () => {
    assert.equal(shouldApplyGreeksFromSchwabQuote({}, false), false);
    assert.equal(shouldApplyGreeksFromSchwabQuote({ delta: 0 }, false), false);
  });

  it("applies after hours when Schwab sends real greeks", () => {
    assert.equal(shouldApplyGreeksFromSchwabQuote({ delta: 0.42 }, false), true);
    assert.equal(shouldApplyGreeksFromSchwabQuote({ vega: 0.01 }, false), true);
  });
});

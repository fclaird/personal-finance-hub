import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  dualReadSourceCategories,
  isStrategyTabSlug,
  strategyLabel,
} from "@/lib/strategy/strategyCategories";

describe("strategy tab taxonomy", () => {
  it("includes situations and the new short-premium / long-option tabs", () => {
    assert.equal(isStrategyTabSlug("situations"), true);
    assert.equal(isStrategyTabSlug("naked-calls"), true);
    assert.equal(isStrategyTabSlug("short-strangles"), true);
    assert.equal(isStrategyTabSlug("butterflies"), true);
    assert.equal(isStrategyTabSlug("long-calls"), true);
    assert.equal(isStrategyTabSlug("buy-and-hold"), false);
    assert.equal(strategyLabel("options-sales"), "Short Puts");
  });

  it("dual-reads legacy covered-calls and options-sales buckets", () => {
    assert.deepEqual(dualReadSourceCategories("naked-calls"), ["naked-calls", "covered-calls"]);
    assert.deepEqual(dualReadSourceCategories("long-calls"), ["long-calls", "options-sales"]);
    assert.deepEqual(dualReadSourceCategories("short-strangles"), ["short-strangles", "spreads"]);
  });
});

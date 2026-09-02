import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { situationKindMatchesTab } from "@/lib/situations/apiTypes";
import {
  dualReadSourceCategories,
  isStrategyTabSlug,
  strategyLabel,
} from "@/lib/strategy/strategyCategories";
import { STRATEGY_TAB_GROUPS } from "@/lib/strategy/strategyTabGroups";

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

  it("puts situations first and maps structure tabs to situation kinds", () => {
    assert.equal(STRATEGY_TAB_GROUPS[0]?.slugs[0], "situations");
    assert.equal(situationKindMatchesTab("short-strangle", "short-strangles"), true);
    assert.equal(situationKindMatchesTab("butterfly", "butterflies"), true);
    assert.equal(situationKindMatchesTab("short-put", "short-strangles"), false);
  });
});

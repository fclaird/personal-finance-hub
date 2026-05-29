import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeGlanceAlternativeSlots,
  normalizeGlanceMarketsSlots,
} from "@/lib/market/glanceTileInstruments";

test("normalizeGlanceMarketsSlots applies defaults and legacy slot 4", () => {
  const slots = normalizeGlanceMarketsSlots(null, "gold");
  assert.deepEqual(slots, ["nasdaq", "sp500", "gold"]);
});

test("normalizeGlanceMarketsSlots reads persisted triple", () => {
  const slots = normalizeGlanceMarketsSlots(["us-nq", "us-es", "vix"]);
  assert.deepEqual(slots, ["us-nq", "us-es", "vix"]);
});

test("normalizeGlanceAlternativeSlots reads four persisted ids", () => {
  const slots = normalizeGlanceAlternativeSlots(["gold", "bitcoin", "ethereum", "vix"]);
  assert.deepEqual(slots, ["gold", "bitcoin", "ethereum", "vix"]);
});

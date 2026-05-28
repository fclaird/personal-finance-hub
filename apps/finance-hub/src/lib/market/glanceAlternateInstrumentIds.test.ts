import assert from "node:assert/strict";
import test from "node:test";

import type { UsMarketGlanceItem } from "@/app/components/terminal/MarketGlanceCard";

import { isGlanceAlternateInstrumentId, pickGlanceAlternateCard } from "@/lib/market/glanceAlternateInstrumentIds";

test("isGlanceAlternateInstrumentId validates known ids", () => {
  assert.equal(isGlanceAlternateInstrumentId("us-cl"), true);
  assert.equal(isGlanceAlternateInstrumentId("fitzy100"), false);
});

test("pickGlanceAlternateCard returns selected card", () => {
  const cards = [
    { id: "gold", label: "Gold", symbol: "GC=F" },
    { id: "us-cl", label: "WTI Crude", symbol: "CL=F" },
  ] as const;
  const picked = pickGlanceAlternateCard([...cards] as UsMarketGlanceItem[], "us-cl");
  assert.equal(picked?.id, "us-cl");
});

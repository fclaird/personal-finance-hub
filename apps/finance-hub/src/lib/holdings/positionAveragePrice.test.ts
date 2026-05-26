import assert from "node:assert/strict";
import test from "node:test";

import { resolvePositionAveragePrice } from "@/lib/holdings/positionAveragePrice";

test("resolvePositionAveragePrice prefers Schwab averagePrice from sync metadata", () => {
  const meta = JSON.stringify({ averagePrice: 3.25, marketValue: -2000 });
  assert.equal(resolvePositionAveragePrice(2.0, meta), 3.25);
});

test("resolvePositionAveragePrice falls back to stored price when metadata missing", () => {
  assert.equal(resolvePositionAveragePrice(4.5, null), 4.5);
});

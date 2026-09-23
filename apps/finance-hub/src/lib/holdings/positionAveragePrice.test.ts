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

test("non-option averagePrice is cost, not the live mark, when cost is present", () => {
  const cost = 41.25;
  const liveMark = 88;
  const metadataJson = JSON.stringify({ averagePrice: cost, marketValue: liveMark * 20 });
  const averagePrice = resolvePositionAveragePrice(cost, metadataJson);
  assert.equal(averagePrice, cost);
  assert.notEqual(averagePrice, liveMark);
});

test("non-option averagePrice uses the position cost when metadata has no averagePrice", () => {
  const cost = 17.5;
  const liveMark = 90;
  assert.equal(resolvePositionAveragePrice(cost, JSON.stringify({ marketValue: liveMark * 10 })), cost);
});

test("non-option averagePrice is null when no stored cost", () => {
  assert.equal(resolvePositionAveragePrice(null, null), null);
  assert.equal(resolvePositionAveragePrice(null, "{}"), null);
  assert.equal(resolvePositionAveragePrice(undefined, JSON.stringify({ marketValue: 500 })), null);
});

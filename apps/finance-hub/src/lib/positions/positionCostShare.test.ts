import assert from "node:assert/strict";
import test from "node:test";

import { positionCostShare } from "@/lib/positions/positionCostShare";

test("positionCostShare prefers average cost over live mark price", () => {
  assert.equal(positionCostShare({ averagePrice: 12.34, price: 56.78 }), 12.34);
});

test("positionCostShare falls back to price when no average cost is available", () => {
  assert.equal(positionCostShare({ averagePrice: null, price: 56.78 }), 56.78);
});

test("positionCostShare ignores invalid numeric values", () => {
  assert.equal(positionCostShare({ averagePrice: Number.NaN, price: Number.NaN }), null);
});

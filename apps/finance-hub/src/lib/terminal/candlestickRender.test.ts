import assert from "node:assert/strict";
import test from "node:test";

import {
  CANDLE_DOWN_COLOR,
  CANDLE_UP_COLOR,
  candleColor,
  candleDirection,
  priceYDomain,
} from "@/lib/terminal/candlestickRender";

test("candleDirection and color for bull vs bear", () => {
  assert.equal(candleDirection(10, 11), "up");
  assert.equal(candleColor(10, 11), CANDLE_UP_COLOR);
  assert.equal(candleDirection(11, 10), "down");
  assert.equal(candleColor(11, 10), CANDLE_DOWN_COLOR);
});

test("priceYDomain pads high and low", () => {
  const [lo, hi] = priceYDomain([
    { tsMs: 1, open: 100, high: 105, low: 98, close: 102 },
    { tsMs: 2, open: 102, high: 108, low: 101, close: 107 },
  ]);
  assert.ok(lo < 98);
  assert.ok(hi > 108);
});

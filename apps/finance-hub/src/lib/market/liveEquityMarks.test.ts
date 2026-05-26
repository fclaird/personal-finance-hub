import assert from "node:assert/strict";
import test from "node:test";

import { liveEquityMarkPx, resolveEquityMarkPx } from "./equityMarkPrice";

test("liveEquityMarkPx prefers normalized last from quotes API", () => {
  assert.equal(liveEquityMarkPx({ last: 143.64, mark: 35.5, close: 35.5 }), 143.64);
  assert.equal(liveEquityMarkPx({ last: null, mark: 42, close: 40 }), 42);
});

test("resolveEquityMarkPx prefers live Schwab mark over price_points and snapshot implied", () => {
  const live = new Map([["RKLB", 143.64]]);
  const pricePoints = new Map([["RKLB", 35.5]]);
  assert.equal(resolveEquityMarkPx("RKLB", live, pricePoints, 35.4979), 143.64);
});

test("resolveEquityMarkPx falls back to price_points then snapshot implied", () => {
  const live = new Map<string, number>();
  const pricePoints = new Map([["RKLB", 35.5]]);
  assert.equal(resolveEquityMarkPx("RKLB", live, pricePoints, 35.4979), 35.5);
  assert.equal(resolveEquityMarkPx("RKLB", live, new Map(), 35.4979), 35.4979);
});

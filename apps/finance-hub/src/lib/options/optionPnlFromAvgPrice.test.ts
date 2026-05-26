import assert from "node:assert/strict";
import test from "node:test";

import {
  optionMarkPerShare,
  optionPnlDollarsFromAvgPrice,
  optionPnlPctFromAvgPrice,
} from "@/lib/options/optionPnlFromAvgPrice";

test("optionMarkPerShare uses signed quantity so shorts stay positive", () => {
  assert.equal(optionMarkPerShare(-2_120, -10), 2.12);
  assert.equal(optionMarkPerShare(2_120, 10), 2.12);
});

test("short option at unchanged mark has zero P/L", () => {
  const row = { price: 2.12, marketValue: -2_120, quantity: -10 };
  assert.ok(Math.abs(optionPnlDollarsFromAvgPrice(row) ?? NaN) < 1e-9);
  assert.ok(Math.abs(optionPnlPctFromAvgPrice(row) ?? NaN) < 1e-9);
});

test("short option P/L pct tracks mark vs entry premium", () => {
  assert.ok(Math.abs((optionPnlPctFromAvgPrice({ price: 2.12, marketValue: -1_060, quantity: -10 }) ?? NaN) - 50) < 1e-9);
  assert.equal(optionPnlPctFromAvgPrice({ price: 2.12, marketValue: 0, quantity: -10 }), 100);
  assert.ok(Math.abs((optionPnlPctFromAvgPrice({ price: 2.12, marketValue: -3_180, quantity: -10 }) ?? NaN) - -50) < 1e-9);
});

test("short option P/L uses entry premium not current mark", () => {
  const row = { price: 3, marketValue: -2_000, quantity: -10 };
  assert.ok(Math.abs((optionPnlDollarsFromAvgPrice(row) ?? NaN) - 1_000) < 1e-6);
  assert.ok(Math.abs((optionPnlPctFromAvgPrice(row) ?? NaN) - 100 / 3) < 1e-6);
});

test("long option P/L pct tracks mark vs entry premium", () => {
  const row = { price: 2.12, marketValue: 2_332, quantity: 10 };
  assert.ok(Math.abs((optionPnlPctFromAvgPrice(row) ?? NaN) - 10) < 1e-9);
  assert.ok(Math.abs((optionPnlDollarsFromAvgPrice(row) ?? NaN) - 212) < 1e-6);
});

test("P/L dollars equals market value minus cost basis", () => {
  const row = { price: 19.18, marketValue: -207_800, quantity: -12 };
  const cost = 19.18 * -12 * 100;
  assert.equal(optionPnlDollarsFromAvgPrice(row), -207_800 - cost);
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAlignedExtendedSeries,
  priceAtOrBefore,
  resampleTimedPointsToGrid,
  toGlanceSeries,
} from "@/lib/market/glanceSessionGrid";

test("priceAtOrBefore returns latest bar at or before timestamp", () => {
  const bars = [
    { tsMs: 1000, close: 10 },
    { tsMs: 2000, close: 20 },
    { tsMs: 3000, close: 30 },
  ];
  assert.equal(priceAtOrBefore(bars, 2500, 0), 20);
  assert.equal(priceAtOrBefore(bars, 500, 99), 99);
});

test("resampleTimedPointsToGrid aligns to canonical timestamps", () => {
  const source = [
    { tsMs: 1000, close: 10 },
    { tsMs: 3000, close: 30 },
  ];
  const grid = [
    { tsMs: 1000, close: 0 },
    { tsMs: 2000, close: 0 },
    { tsMs: 3000, close: 0 },
  ];
  const out = resampleTimedPointsToGrid(source, grid);
  assert.deepEqual(out, [
    { tsMs: 1000, close: 10 },
    { tsMs: 2000, close: 10 },
    { tsMs: 3000, close: 30 },
  ]);
});

test("buildAlignedExtendedSeries anchors at session close", () => {
  const regular = toGlanceSeries([
    { tsMs: 1000, close: 99 },
    { tsMs: 2000, close: 100 },
  ]);
  const extended = [
    { tsMs: 2000, close: 100 },
    { tsMs: 3000, close: 101 },
  ];
  const out = buildAlignedExtendedSeries(regular, extended, 100);
  assert.equal(out.length, 2);
  assert.equal(out[0]!.close, 100);
  assert.equal(out[1]!.close, 101);
  assert.equal(out[1]!.tsMs, 3000);
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  boxZoomView,
  clampView,
  fitView,
  panView,
  resetView,
  ySpanForX,
  zoomAroundCursor,
  type ChartView,
} from "@/lib/strategyLab/chartView";

const limits: ChartView = { xMin: 0, xMax: 200, yMin: -1000, yMax: 9000 };
const home: ChartView = { xMin: 40, xMax: 160, yMin: -200, yMax: 4000 };

describe("chart view transforms", () => {
  it("zooms around the cursor and keeps that point in the same place", () => {
    const cursor = { x: 70, y: 1000 };
    const next = zoomAroundCursor(home, cursor, 2, limits);
    assert.equal(next.xMax - next.xMin, (home.xMax - home.xMin) / 2);
    assert.equal(next.yMax - next.yMin, (home.yMax - home.yMin) / 2);
    const before = (cursor.x - home.xMin) / (home.xMax - home.xMin);
    const after = (cursor.x - next.xMin) / (next.xMax - next.xMin);
    assert.ok(Math.abs(before - after) < 1e-9);
    const beforeY = (cursor.y - home.yMin) / (home.yMax - home.yMin);
    const afterY = (cursor.y - next.yMin) / (next.yMax - next.yMin);
    assert.ok(Math.abs(beforeY - afterY) < 1e-9);
  });

  it("zooms out around the cursor until the data stops it", () => {
    const wide = zoomAroundCursor(home, { x: 100, y: 1900 }, 0.25, limits);
    assert.ok(wide.xMax - wide.xMin > home.xMax - home.xMin);
    const stuck = zoomAroundCursor(limits, { x: 100, y: 0 }, 0.1, limits);
    assert.deepEqual(stuck, limits);
  });

  it("clamps a pan that would leave the data", () => {
    const pushed = panView(home, -1000, 50_000, limits);
    assert.equal(pushed.xMin, limits.xMin);
    assert.equal(pushed.xMax - pushed.xMin, home.xMax - home.xMin);
    assert.equal(pushed.yMax, limits.yMax);
    assert.equal(pushed.yMax - pushed.yMin, home.yMax - home.yMin);
    const nudged = panView(home, 10, -20, limits);
    assert.equal(nudged.xMin, home.xMin + 10);
    assert.equal(nudged.yMin, home.yMin - 20);
  });

  it("resets to the fitted window and fits a typed price range", () => {
    const zoomed = zoomAroundCursor(home, { x: 80, y: 500 }, 3, limits);
    assert.deepEqual(resetView(home, limits), home);
    assert.notDeepEqual(zoomed, home);
    const fitted = fitView(90, 140, -50, 800, limits);
    assert.equal(fitted.xMin, 90);
    assert.equal(fitted.xMax, 140);
    assert.equal(fitted.yMin, -50);
    assert.equal(fitted.yMax, 800);
    const outside = fitView(-50, 500, -5000, 20_000, limits);
    assert.deepEqual(outside, limits);
  });

  it("box-zooms to the dragged rectangle and ignores an empty one", () => {
    const boxed = boxZoomView({ x: 110, y: 2000 }, { x: 80, y: 200 }, limits);
    assert.ok(boxed);
    assert.equal(boxed?.xMin, 80);
    assert.equal(boxed?.xMax, 110);
    assert.equal(boxed?.yMin, 200);
    assert.equal(boxed?.yMax, 2000);
    assert.equal(boxZoomView({ x: 10, y: 10 }, { x: 10, y: 40 }, limits), null);
  });

  it("reads the P&L span inside a price window", () => {
    const samples = [
      { x: 10, y: -100 },
      { x: 50, y: 200 },
      { x: 80, y: 50 },
      { x: 120, y: 900 },
    ];
    const span = ySpanForX(samples, 40, 90);
    assert.ok(span);
    assert.ok(span!.min < 50);
    assert.ok(span!.max > 200);
    assert.equal(ySpanForX(samples, 200, 300), null);
  });

  it("does not let a clamp invert the window", () => {
    const collapsed = clampView({ xMin: 50, xMax: 50, yMin: 10, yMax: 10 }, limits);
    assert.ok(collapsed.xMax > collapsed.xMin);
    assert.ok(collapsed.yMax > collapsed.yMin);
    assert.ok(collapsed.xMin >= limits.xMin && collapsed.xMax <= limits.xMax);
  });
});

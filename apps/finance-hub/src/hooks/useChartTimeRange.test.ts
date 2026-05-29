import assert from "node:assert/strict";
import test from "node:test";

import { windowSinceMs } from "@/lib/terminal/candleWindowTime";

/** Mirror useChartTimeRange needsEarlierData logic for unit tests. */
function needsEarlierDataForTest(
  window: "6M",
  visibleFromMs: number,
  loadedFromMs: number,
  loadedToMs: number,
): boolean {
  const span = loadedToMs - loadedFromMs;
  const edge = Math.max(span * 0.1, 60_000);
  const windowStartMs = windowSinceMs(window);
  return visibleFromMs - loadedFromMs < edge && loadedFromMs > windowStartMs + edge;
}

test("initial chart view at loadedFromMs does not request earlier data", () => {
  const window = "6M";
  const loadedFromMs = windowSinceMs(window) + 5 * 24 * 60 * 60 * 1000;
  const loadedToMs = Date.now();
  assert.equal(needsEarlierDataForTest(window, loadedFromMs, loadedFromMs, loadedToMs), false);
});

test("pan near left edge requests earlier data when more window history exists", () => {
  const window = "6M";
  const windowStartMs = windowSinceMs(window);
  const loadedFromMs = windowStartMs + 30 * 24 * 60 * 60 * 1000;
  const loadedToMs = Date.now();
  const visibleFromMs = loadedFromMs + 30_000;
  assert.equal(needsEarlierDataForTest(window, visibleFromMs, loadedFromMs, loadedToMs), true);
});

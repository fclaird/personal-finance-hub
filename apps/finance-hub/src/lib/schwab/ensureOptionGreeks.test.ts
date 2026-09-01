import assert from "node:assert/strict";
import test from "node:test";

import { evaluateOptionDataFreshness } from "@/lib/schwab/ensureOptionGreeks";
import { schwabStaleThresholdMs } from "@/lib/schwab/schwabStaleThreshold";

test("evaluateOptionDataFreshness flags stale greeks and holdings", () => {
  const staleMs = schwabStaleThresholdMs(true);
  const old = new Date(Date.now() - staleMs - 60_000).toISOString();

  const freshness = evaluateOptionDataFreshness({
    openOptionCount: 3,
    missingDeltaCount: 2,
    latestGreeksUpdatedAt: old,
    holdingsAsOf: old,
    schwabRefreshStale: false,
    rthOpen: true,
  });

  assert.equal(freshness.hasOptionPositions, true);
  assert.equal(freshness.missingDeltaCount, 2);
  assert.equal(freshness.needsGreeksRefresh, true);
  assert.equal(freshness.needsHoldingsRefresh, true);
});

test("evaluateOptionDataFreshness is fresh when no option positions", () => {
  const freshness = evaluateOptionDataFreshness({
    openOptionCount: 0,
    missingDeltaCount: 0,
    latestGreeksUpdatedAt: null,
    holdingsAsOf: null,
    schwabRefreshStale: true,
    rthOpen: true,
  });

  assert.equal(freshness.hasOptionPositions, false);
  assert.equal(freshness.needsGreeksRefresh, false);
  assert.equal(freshness.needsHoldingsRefresh, false);
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { schwabRefreshPlan } from "./refreshOrchestrator";
import { schwabStaleThresholdMs } from "./refreshStatus";

describe("schwabRefreshPlan", () => {
  it("rth bundle includes quotes and greeks but not slow by default", () => {
    const plan = schwabRefreshPlan("rth");
    assert.equal(plan.quotes, true);
    assert.equal(plan.greeks, true);
    assert.equal(plan.slow, false);
  });

  it("slow bundle includes slow steps and options after holdings", () => {
    const plan = schwabRefreshPlan("slow");
    assert.equal(plan.quotes, false);
    assert.equal(plan.greeks, false);
    assert.equal(plan.greeksAfterHoldings, true);
    assert.equal(plan.slow, true);
  });

  it("closed bundle runs options only after holdings sync", () => {
    const plan = schwabRefreshPlan("closed");
    assert.equal(plan.quotes, true);
    assert.equal(plan.greeks, false);
    assert.equal(plan.greeksAfterHoldings, true);
    assert.equal(plan.slow, true);
  });
});

describe("schwabStaleThresholdMs", () => {
  it("uses 60s when RTH open and 600s when closed", () => {
    assert.equal(schwabStaleThresholdMs(true), 60_000);
    assert.equal(schwabStaleThresholdMs(false), 600_000);
  });
});

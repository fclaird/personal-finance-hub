import assert from "node:assert/strict";
import test from "node:test";

import { planFundRemarkSkipKey } from "./optionsExposure";

test("planFundRemarkSkipKey scopes plan-fund live remark skip to bucket", () => {
  const bucketScoped = new Set([
    planFundRemarkSkipKey("529", "VTI"),
  ]);
  assert.ok(bucketScoped.has(planFundRemarkSkipKey("529", "VTI")));
  assert.ok(!bucketScoped.has(planFundRemarkSkipKey("brokerage", "VTI")));
  assert.ok(!bucketScoped.has(planFundRemarkSkipKey("retirement", "vti")));
});

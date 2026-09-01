import assert from "node:assert/strict";
import test from "node:test";

import { optionPositionTheta } from "@/lib/options/optionPositionTheta";

test("optionPositionTheta scales per-share theta by qty and contract multiplier", () => {
  assert.equal(
    optionPositionTheta({ securityType: "option", theta: -0.05, quantity: -2 }),
    10,
  );
});

test("optionPositionTheta returns null for non-options or missing greeks", () => {
  assert.equal(optionPositionTheta({ securityType: "equity", theta: -0.05, quantity: 100 }), null);
  assert.equal(optionPositionTheta({ securityType: "option", theta: null, quantity: 1 }), null);
});

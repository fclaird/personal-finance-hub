import assert from "node:assert/strict";
import test from "node:test";

import {
  computeOptionMarginRoi,
  optionAnnualizedRoiPct,
  optionMarginSecuredDollars,
  optionPremiumCashReceived,
  optionRoiOnMarginPct,
} from "./optionMarginRoi";

test("optionMarginSecuredDollars is |qty| × strike × 100", () => {
  assert.equal(optionMarginSecuredDollars(-2, 450), 90_000);
  assert.equal(optionMarginSecuredDollars(2, 450), 90_000);
});

test("optionPremiumCashReceived uses |qty| × 100 × |entry|", () => {
  assert.equal(optionPremiumCashReceived(-10, 2.12), 2120);
});

test("computeOptionMarginRoi for short put", () => {
  const r = computeOptionMarginRoi({
    quantity: -2,
    optionStrike: 450,
    entryPricePerShare: 3.5,
    dte: 30,
  });
  assert.ok(r);
  assert.equal(r!.marginSecured, 90_000);
  assert.equal(r!.cashReceived, 700);
  assert.ok(Math.abs(r!.roiPct - (700 / 90_000) * 100) < 1e-9);
});

test("optionAnnualizedRoiPct simple 365/DTE", () => {
  assert.ok(Math.abs(optionAnnualizedRoiPct(0.2, 7)! - 0.2 * (365 / 7)) < 0.01);
});

test("computeOptionMarginRoi returns null for long options", () => {
  assert.equal(
    computeOptionMarginRoi({
      quantity: 5,
      optionStrike: 100,
      entryPricePerShare: 2,
      dte: 14,
    }),
    null,
  );
});

test("optionRoiOnMarginPct", () => {
  assert.equal(optionRoiOnMarginPct(200, 10_000), 2);
});

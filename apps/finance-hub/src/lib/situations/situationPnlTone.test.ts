import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { pnlTone, SITUATION_FILL_CASHFLOW_CLASS } from "@/lib/situations/situationPnlTone";

describe("situationPnlTone", () => {
  it("close-fill BTC debit stays grey (cashflow, not P/L)", () => {
    // NVDA 230C child fill $-1,106.27 must not scream red.
    assert.equal(pnlTone(-1106.27, { realized: false }), SITUATION_FILL_CASHFLOW_CLASS);
    assert.equal(pnlTone(-366.27, { realized: false }), SITUATION_FILL_CASHFLOW_CLASS);
  });

  it("open-credit fills stay grey even when the credit is positive", () => {
    assert.equal(pnlTone(9067.17, { realized: false }), SITUATION_FILL_CASHFLOW_CLASS);
  });

  it("REALIZED header / closed-book Net is green on gain, red on loss", () => {
    const gain = pnlTone(2257.34, { realized: true });
    const loss = pnlTone(-100, { realized: true });
    assert.match(gain, /emerald/);
    assert.match(loss, /red/);
    assert.notEqual(gain, SITUATION_FILL_CASHFLOW_CLASS);
    assert.notEqual(loss, SITUATION_FILL_CASHFLOW_CLASS);
  });

  it("zero stays grey", () => {
    assert.equal(pnlTone(0, { realized: true }), SITUATION_FILL_CASHFLOW_CLASS);
  });
});

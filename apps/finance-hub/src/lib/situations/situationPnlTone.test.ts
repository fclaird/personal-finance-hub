import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatSignedUsd2 } from "@/lib/format";
import {
  pnlTone,
  SITUATION_ACTION_LINE_CLASS,
  SITUATION_FILL_CASHFLOW_CLASS,
} from "@/lib/situations/situationPnlTone";

describe("situationPnlTone", () => {
  it("close-fill BTC debit stays grey (cashflow, not P/L)", () => {
    // NVDA 230C child fill $-1,106.27 must not scream red.
    assert.equal(pnlTone(-1106.27, { realized: false }), SITUATION_FILL_CASHFLOW_CLASS);
    assert.equal(pnlTone(-366.27, { realized: false }), SITUATION_FILL_CASHFLOW_CLASS);
  });

  it("CLOSE / LEG OUT action-line cashflow is grey, never debit-as-loss (AVGO-shaped)", () => {
    // ~$423 leg-out and ~$1400 final close are BTC premiums, not realized losses.
    assert.equal(pnlTone(-423.12, { realized: false }), SITUATION_FILL_CASHFLOW_CLASS);
    assert.equal(pnlTone(-1443.12, { realized: false }), SITUATION_FILL_CASHFLOW_CLASS);
    assert.doesNotMatch(SITUATION_FILL_CASHFLOW_CLASS, /emerald|red/);
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
    assert.notEqual(gain, SITUATION_ACTION_LINE_CLASS);
  });

  it("zero stays grey", () => {
    assert.equal(pnlTone(0, { realized: true }), SITUATION_FILL_CASHFLOW_CLASS);
  });

  it("realized losses show a minus on the line item, not inside $-", () => {
    assert.match(formatSignedUsd2(4294.64), /^\$/);
    assert.doesNotMatch(formatSignedUsd2(4294.64), /^-/);
    assert.match(formatSignedUsd2(-22261.03), /^-\$/);
    assert.doesNotMatch(formatSignedUsd2(-22261.03), /^\$/);
  });
});

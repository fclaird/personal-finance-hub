import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  blackScholesPrice,
  bookCreditDollars,
  bookCurrentPnl,
  buildShortStrangleRiskProfile,
  expirationPnlAtSpot,
} from "@/lib/options/shortStrangleRiskProfile";

const qqqLegs = [
  { right: "P" as const, strike: 695, quantity: -3, entryPrice: 2.766767, markPrice: 0.745, iv: 0.1796 },
  { right: "C" as const, strike: 735, quantity: -3, entryPrice: 1.2368, markPrice: 0.595, iv: 0.1294 },
];

describe("shortStrangleRiskProfile", () => {
  it("matches ToS max credit on the QQQ 695/735 3-lot", () => {
    const credit = bookCreditDollars(qqqLegs);
    assert.ok(credit != null);
    assert.ok(Math.abs(credit! - 1201.07) < 0.5);
  });

  it("current P&L is credit minus buyback marks", () => {
    const pnl = bookCurrentPnl(qqqLegs);
    // MV ≈ -402; cost ≈ -1201; pnl ≈ +799
    assert.ok(pnl != null && pnl > 700 && pnl < 900);
  });

  it("expiration P&L is max credit between the strikes", () => {
    const mid = expirationPnlAtSpot(qqqLegs, 717.5);
    const credit = bookCreditDollars(qqqLegs)!;
    assert.ok(Math.abs(mid - credit) < 0.5);
  });

  it("expiration P&L drops outside the wings", () => {
    const left = expirationPnlAtSpot(qqqLegs, 650);
    const right = expirationPnlAtSpot(qqqLegs, 780);
    assert.ok(left < 0);
    assert.ok(right < 0);
  });

  it("buildShortStrangleRiskProfile labels strikes, spot, and 50% target", () => {
    const model = buildShortStrangleRiskProfile({
      legs: qqqLegs,
      spot: 717.52,
      dte: 5,
      profitTargetPct: 50,
    });
    assert.equal(model.putStrike, 695);
    assert.equal(model.callStrike, 735);
    assert.equal(model.spot, 717.52);
    assert.ok(model.maxProfit != null && model.maxProfit > 1190);
    assert.ok(model.profitTargetPnl != null && Math.abs(model.profitTargetPnl - model.maxProfit! * 0.5) < 1);
    assert.ok(model.points.length >= 50);
    assert.ok(model.points.every((p) => p.t0Pnl != null));
    // Between strikes, expiration P&L ≈ max credit
    const mid = model.points.find((p) => p.spot > 710 && p.spot < 720)!;
    assert.ok(Math.abs(mid.expirationPnl - model.maxProfit!) < 1);
  });

  it("blackScholesPrice is near intrinsic at expiry", () => {
    assert.ok(Math.abs(blackScholesPrice("C", 110, 100, 0, 0.05, 0.2) - 10) < 1e-9);
    assert.ok(Math.abs(blackScholesPrice("P", 90, 100, 0, 0.05, 0.2) - 10) < 1e-9);
  });
});

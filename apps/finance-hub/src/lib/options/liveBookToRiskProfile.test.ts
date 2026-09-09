import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { evaluateOptionRiskFlags, type OptionRiskPosition } from "@/lib/alerts/optionRisk";
import { liveBookToRiskProfile } from "@/lib/options/liveBookToRiskProfile";
import type { LiveStructureBook } from "@/lib/situations/liveStructures";

function leg(
  partial: Partial<OptionRiskPosition> &
    Pick<OptionRiskPosition, "positionId" | "right" | "strike" | "quantity">,
): OptionRiskPosition {
  const flags = evaluateOptionRiskFlags({
    quantity: partial.quantity,
    right: partial.right,
    strike: partial.strike ?? 100,
    dte: partial.dte ?? 5,
    delta: partial.delta ?? (partial.right === "P" ? 0.15 : -0.15),
    spot: partial.spot ?? 717.52,
    coveringShares: 0,
    pairedOppositeShort: true,
  });
  return {
    accountId: "a1",
    accountName: "Brokerage",
    symbol: "QQQ",
    underlying: "QQQ",
    expiration: "2026-09-11",
    dte: 5,
    delta: partial.right === "P" ? 0.15 : -0.15,
    spot: 717.52,
    intrinsic: 0,
    marginSecured: 10000,
    avgPrice: null,
    markPrice: null,
    iv: null,
    flags,
    ...partial,
  };
}

describe("liveBookToRiskProfile", () => {
  it("builds expiration + T+0 model from enriched live legs", () => {
    const book: LiveStructureBook = {
      key: "a1|QQQ",
      kind: "short-strangle",
      accountId: "a1",
      accountName: "Brokerage",
      underlying: "QQQ",
      expiration: "2026-09-11",
      dte: 5,
      legs: [
        leg({
          positionId: "p",
          right: "P",
          strike: 695,
          quantity: -3,
          avgPrice: 2.766767,
          markPrice: 0.745,
          iv: 17.96,
        }),
        leg({
          positionId: "c",
          right: "C",
          strike: 735,
          quantity: -3,
          avgPrice: 1.2368,
          markPrice: 0.595,
          iv: 12.94,
        }),
      ],
    };
    const model = liveBookToRiskProfile(book);
    assert.ok(model);
    assert.equal(model!.putStrike, 695);
    assert.equal(model!.callStrike, 735);
    assert.equal(model!.spot, 717.52);
    assert.ok(model!.maxProfit != null && model!.maxProfit > 1190);
    assert.ok(model!.points.every((p) => p.t0Pnl != null));
    assert.ok(model!.lowerBreakeven != null && model!.upperBreakeven != null);
  });

  it("returns null when legs lack entry/mark", () => {
    const book: LiveStructureBook = {
      key: "a1|QQQ",
      kind: "short-strangle",
      accountId: "a1",
      accountName: "Brokerage",
      underlying: "QQQ",
      expiration: "2026-09-11",
      dte: 5,
      legs: [
        leg({ positionId: "p", right: "P", strike: 695, quantity: -3 }),
        leg({ positionId: "c", right: "C", strike: 735, quantity: -3 }),
      ],
    };
    assert.equal(liveBookToRiskProfile(book), null);
  });

  it("builds expiration curve without IV (T+0 null)", () => {
    const book: LiveStructureBook = {
      key: "a1|QQQ",
      kind: "short-strangle",
      accountId: "a1",
      accountName: "Brokerage",
      underlying: "QQQ",
      expiration: "2026-09-11",
      dte: 5,
      legs: [
        leg({
          positionId: "p",
          right: "P",
          strike: 695,
          quantity: -3,
          avgPrice: 2.77,
          markPrice: 0.75,
          iv: null,
        }),
        leg({
          positionId: "c",
          right: "C",
          strike: 735,
          quantity: -3,
          avgPrice: 1.24,
          markPrice: 0.6,
          iv: null,
        }),
      ],
    };
    const model = liveBookToRiskProfile(book);
    assert.ok(model);
    assert.ok(model!.points.length > 0);
    assert.ok(model!.points.every((p) => p.t0Pnl == null));
  });

  it("falls back to midpoint of short put/call strikes when spot is missing", () => {
    const book: LiveStructureBook = {
      key: "a1|BE",
      kind: "short-strangle",
      accountId: "a1",
      accountName: "Brokerage",
      underlying: "BE",
      expiration: "2026-09-11",
      dte: 5,
      legs: [
        leg({
          positionId: "p",
          right: "P",
          strike: 240,
          quantity: -2,
          avgPrice: 3.5,
          markPrice: 1.2,
          spot: null,
        }),
        leg({
          positionId: "c",
          right: "C",
          strike: 290,
          quantity: -2,
          avgPrice: 2.1,
          markPrice: 0.8,
          spot: null,
        }),
      ],
    };
    const model = liveBookToRiskProfile(book);
    assert.ok(model);
    assert.equal(model!.spot, 265);
    assert.ok(model!.points.length > 0);
  });

  it("spotOverride wins over book/OHLCV spot so the graphic can use extended-hours last", () => {
    const book: LiveStructureBook = {
      key: "a1|NBIS",
      kind: "short-strangle",
      accountId: "a1",
      accountName: "Brokerage",
      underlying: "NBIS",
      expiration: "2026-09-11",
      dte: 5,
      legs: [
        leg({
          positionId: "p",
          right: "P",
          strike: 210,
          quantity: -2,
          avgPrice: 4.1,
          markPrice: 1.5,
          spot: 223.05,
          underlying: "NBIS",
          symbol: "NBIS",
        }),
        leg({
          positionId: "c",
          right: "C",
          strike: 260,
          quantity: -2,
          avgPrice: 3.2,
          markPrice: 2.8,
          spot: 223.05,
          underlying: "NBIS",
          symbol: "NBIS",
        }),
      ],
    };
    const ohlcv = liveBookToRiskProfile(book);
    assert.equal(ohlcv!.spot, 223.05);
    const live = liveBookToRiskProfile(book, { spotOverride: 245.2 });
    assert.equal(live!.spot, 245.2);
    assert.ok(live!.points.some((p) => p.spot >= 245 && p.spot <= 246));
  });

});

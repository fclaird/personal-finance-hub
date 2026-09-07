import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { evaluateOptionRiskFlags, type OptionRiskPosition } from "@/lib/alerts/optionRisk";
import { groupLiveStructureBooks, liveBookLinkedToOpenSituation } from "@/lib/situations/liveStructures";

function pos(partial: Partial<OptionRiskPosition> & Pick<OptionRiskPosition, "positionId" | "right" | "strike" | "quantity">): OptionRiskPosition {
  const flags = evaluateOptionRiskFlags({
    quantity: partial.quantity,
    right: partial.right,
    strike: partial.strike ?? 100,
    dte: partial.dte ?? 30,
    delta: partial.delta ?? (partial.right === "P" ? 0.15 : -0.15),
    spot: partial.spot ?? 100,
    coveringShares: 0,
    pairedOppositeShort: true,
  });
  return {
    accountId: "a1",
    accountName: "Brokerage",
    symbol: "SPY",
    underlying: "SPY",
    expiration: "2026-10-16",
    dte: 30,
    delta: partial.right === "P" ? 0.15 : -0.15,
    spot: 100,
    intrinsic: 0,
    marginSecured: 10000,
    avgPrice: null,
    markPrice: null,
    iv: null,
    flags,
    ...partial,
  };
}

describe("groupLiveStructureBooks", () => {
  it("pairs live short put+call as a strangle book", () => {
    const books = groupLiveStructureBooks(
      [
        pos({ positionId: "p", right: "P", strike: 90, quantity: -1 }),
        pos({ positionId: "c", right: "C", strike: 110, quantity: -1 }),
      ],
      "short-strangle",
    );
    assert.equal(books.length, 1);
    assert.equal(books[0]!.underlying, "SPY");
    assert.equal(books[0]!.legs.length, 2);
  });

  it("keeps a butterfly book when a different-expiration LEAP exists on the same underlying", () => {
    const wing = (id: string, strike: number, qty: number) =>
      pos({
        positionId: id,
        right: "C",
        strike,
        quantity: qty,
        underlying: "IWM",
        symbol: "IWM",
        flags: evaluateOptionRiskFlags({
          quantity: qty,
          right: "C",
          strike,
          dte: 30,
          delta: qty < 0 ? -0.5 : 0.3,
          spot: 220,
          coveringShares: 0,
          pairedOppositeShort: false,
        }),
      });
    const books = groupLiveStructureBooks(
      [
        wing("w1", 200, 1),
        wing("body", 220, -2),
        wing("w2", 240, 1),
        pos({
          positionId: "leap",
          right: "C",
          strike: 180,
          quantity: 1,
          underlying: "IWM",
          symbol: "IWM",
          expiration: "2027-01-15",
          dte: 400,
          flags: evaluateOptionRiskFlags({
            quantity: 1,
            right: "C",
            strike: 180,
            dte: 400,
            delta: 0.7,
            spot: 220,
            coveringShares: 0,
            pairedOppositeShort: false,
          }),
        }),
      ],
      "butterfly",
    );
    assert.equal(books.length, 1);
    assert.equal(books[0]!.kind, "butterfly");
    assert.equal(books[0]!.legs.length, 3);
    assert.ok(!books[0]!.legs.some((l) => l.positionId === "leap"));
  });

  it("detects a 1-2-1 butterfly from live legs", () => {
    const books = groupLiveStructureBooks(
      [
        pos({ positionId: "w1", right: "C", strike: 90, quantity: 1, flags: evaluateOptionRiskFlags({ quantity: 1, right: "C", strike: 90, dte: 30, delta: 0.4, spot: 100, coveringShares: 0, pairedOppositeShort: false }) }),
        pos({ positionId: "body", right: "C", strike: 100, quantity: -2, flags: evaluateOptionRiskFlags({ quantity: -2, right: "C", strike: 100, dte: 30, delta: -0.5, spot: 100, coveringShares: 0, pairedOppositeShort: false }) }),
        pos({ positionId: "w2", right: "C", strike: 110, quantity: 1, flags: evaluateOptionRiskFlags({ quantity: 1, right: "C", strike: 110, dte: 30, delta: 0.2, spot: 100, coveringShares: 0, pairedOppositeShort: false }) }),
      ],
      "butterfly",
    );
    assert.equal(books.length, 1);
    assert.equal(books[0]!.kind, "butterfly");
    assert.equal(books[0]!.legs.length, 3);
  });

  it("excludes a long LEAP on the same underlying from the short-strangle book", () => {
    const leapFlags = evaluateOptionRiskFlags({
      quantity: 2,
      right: "C",
      strike: 400,
      dte: 400,
      delta: 0.7,
      spot: 250,
      coveringShares: 0,
      pairedOppositeShort: false,
    });
    const books = groupLiveStructureBooks(
      [
        pos({ positionId: "p", right: "P", strike: 230, quantity: -10, underlying: "AVGO", symbol: "AVGO" }),
        pos({ positionId: "c", right: "C", strike: 290, quantity: -10, underlying: "AVGO", symbol: "AVGO" }),
        pos({
          positionId: "leap",
          right: "C",
          strike: 400,
          quantity: 2,
          underlying: "AVGO",
          symbol: "AVGO",
          expiration: "2027-01-15",
          dte: 400,
          flags: leapFlags,
        }),
      ],
      "short-strangle",
    );
    assert.equal(books.length, 1);
    assert.equal(books[0]!.legs.length, 2);
    assert.deepEqual(
      books[0]!.legs.map((l) => l.positionId).sort(),
      ["c", "p"],
    );
  });

  it("does not call a lone short put a strangle", () => {
    const books = groupLiveStructureBooks(
      [pos({ positionId: "p", right: "P", strike: 90, quantity: -1, flags: evaluateOptionRiskFlags({ quantity: -1, right: "P", strike: 90, dte: 30, delta: 0.15, spot: 100, coveringShares: 0, pairedOppositeShort: false }) })],
      "short-strangle",
    );
    assert.equal(books.length, 0);
  });

  it("matches an open situation on account + underlying + kind", () => {
    const books = groupLiveStructureBooks(
      [
        pos({ positionId: "p", right: "P", strike: 90, quantity: -1 }),
        pos({ positionId: "c", right: "C", strike: 110, quantity: -1 }),
      ],
      "short-strangle",
    );
    assert.equal(
      liveBookLinkedToOpenSituation(books[0]!, [
        { accountId: "a1", underlying: "spy", kind: "short-strangle", status: "open", linkStatus: "auto" },
      ]),
      true,
    );
    assert.equal(
      liveBookLinkedToOpenSituation(books[0]!, [
        { accountId: "a1", underlying: "SPY", kind: "short-strangle", status: "closed", linkStatus: "confirmed" },
      ]),
      false,
    );
  });
});

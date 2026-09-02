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

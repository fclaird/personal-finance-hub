import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { evaluateOptionRiskFlags, type OptionRiskPosition } from "@/lib/alerts/optionRisk";
import { groupLiveBooksForTab, groupLiveStructureBooks, liveBookLinkedToOpenSituation } from "@/lib/situations/liveStructures";

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

describe("groupLiveBooksForTab", () => {
  it("places a lone short put on the short-puts tab, not strangles", () => {
    const legs = [
      pos({
        positionId: "p",
        right: "P",
        strike: 90,
        quantity: -1,
        flags: evaluateOptionRiskFlags({
          quantity: -1,
          right: "P",
          strike: 90,
          dte: 30,
          delta: 0.15,
          spot: 100,
          coveringShares: 0,
          pairedOppositeShort: false,
        }),
      }),
    ];
    assert.equal(groupLiveBooksForTab(legs, "short-strangles").length, 0);
    const puts = groupLiveBooksForTab(legs, "options-sales");
    assert.equal(puts.length, 1);
    assert.equal(puts[0]!.kind, "short-put");
    assert.equal(puts[0]!.underlying, "SPY");
  });

  it("places a naked short call on naked-calls", () => {
    const legs = [
      pos({
        positionId: "c",
        right: "C",
        strike: 110,
        quantity: -2,
        flags: evaluateOptionRiskFlags({
          quantity: -2,
          right: "C",
          strike: 110,
          dte: 30,
          delta: -0.15,
          spot: 100,
          coveringShares: 0,
          pairedOppositeShort: false,
        }),
      }),
    ];
    const books = groupLiveBooksForTab(legs, "naked-calls");
    assert.equal(books.length, 1);
    assert.equal(books[0]!.kind, "naked-call");
    assert.equal(groupLiveBooksForTab(legs, "short-strangles").length, 0);
  });

  it("places a two-strike call vertical on spreads", () => {
    const legs = [
      pos({
        positionId: "short",
        right: "C",
        strike: 110,
        quantity: -1,
        flags: evaluateOptionRiskFlags({
          quantity: -1,
          right: "C",
          strike: 110,
          dte: 30,
          delta: -0.2,
          spot: 100,
          coveringShares: 0,
          pairedOppositeShort: false,
        }),
      }),
      pos({
        positionId: "long",
        right: "C",
        strike: 120,
        quantity: 1,
        flags: evaluateOptionRiskFlags({
          quantity: 1,
          right: "C",
          strike: 120,
          dte: 30,
          delta: 0.1,
          spot: 100,
          coveringShares: 0,
          pairedOppositeShort: false,
        }),
      }),
    ];
    const books = groupLiveBooksForTab(legs, "spreads");
    assert.equal(books.length, 1);
    assert.equal(books[0]!.kind, "spread");
    assert.equal(books[0]!.legs.length, 2);
  });

  it("does not special-case a ticker: same grouping for any underlying", () => {
    const legs = [
      pos({
        positionId: "c",
        right: "C",
        strike: 250,
        quantity: -1,
        underlying: "ABCD",
        symbol: "ABCD",
        flags: evaluateOptionRiskFlags({
          quantity: -1,
          right: "C",
          strike: 250,
          dte: 10,
          delta: -0.12,
          spot: 223,
          coveringShares: 0,
          pairedOppositeShort: false,
        }),
      }),
    ];
    const books = groupLiveBooksForTab(legs, "naked-calls");
    assert.equal(books[0]!.underlying, "ABCD");
    assert.equal(groupLiveBooksForTab(legs, "all")[0]!.underlying, "ABCD");
  });

  it("earnings tab keeps shorts whose expiration is near an earnings date", () => {
    const legs = [
      pos({
        positionId: "c",
        right: "C",
        strike: 110,
        quantity: -1,
        underlying: "XYZ",
        symbol: "XYZ",
        expiration: "2026-09-18",
        flags: evaluateOptionRiskFlags({
          quantity: -1,
          right: "C",
          strike: 110,
          dte: 9,
          delta: -0.2,
          spot: 100,
          coveringShares: 0,
          pairedOppositeShort: false,
        }),
      }),
    ];
    const none = groupLiveBooksForTab(legs, "earnings", { earningsNear: [] });
    assert.equal(none.length, 0);
    const hit = groupLiveBooksForTab(legs, "earnings", {
      earningsNear: [{ symbol: "XYZ", earnings_date: "2026-09-17" }],
    });
    assert.equal(hit.length, 1);
    assert.equal(hit[0]!.kind, "earnings");
    assert.equal(hit[0]!.underlying, "XYZ");
  });
});

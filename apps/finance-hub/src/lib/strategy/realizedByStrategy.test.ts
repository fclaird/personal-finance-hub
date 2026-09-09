import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SituationMemberView } from "@/lib/situations/apiTypes";
import {
  aggregateClosedRealized,
  closedBookRealized,
  parseRealizedPeriod,
  realizedEventDate,
  realizedSummaryToCsv,
  type RealizedBookInput,
} from "@/lib/strategy/realizedByStrategy";

function m(
  partial: Partial<SituationMemberView> & Pick<SituationMemberView, "transactionId" | "role" | "tradeDate">,
): SituationMemberView {
  return {
    tradeTime: null,
    symbol: null,
    underlying: null,
    expiration: null,
    right: null,
    strike: null,
    price: null,
    quantity: null,
    positionEffect: null,
    netAmount: null,
    instruction: null,
    description: null,
    orderId: null,
    deltaAtFill: null,
    ...partial,
  };
}

function avgoStrangle(opts: { closedOn: string; status?: string; linkStatus?: string }): RealizedBookInput {
  // Open credit 800+600; buybacks −200/−50 → realized +1150 (same as tree Realized / closed Net).
  return {
    id: "sit-avgo",
    underlying: "AVGO",
    kind: "short-strangle",
    status: opts.status ?? "closed",
    linkStatus: opts.linkStatus ?? "auto",
    closedOn: opts.closedOn,
    members: [
      m({
        transactionId: "oP",
        role: "open",
        tradeDate: "2026-03-01",
        symbol: "AVGO  260417P00180000",
        quantity: -1,
        netAmount: 800,
      }),
      m({
        transactionId: "oC",
        role: "open",
        tradeDate: "2026-03-01",
        symbol: "AVGO  260417C00220000",
        quantity: -1,
        netAmount: 600,
      }),
      m({
        transactionId: "cP",
        role: "close",
        tradeDate: opts.closedOn,
        symbol: "AVGO  260417P00180000",
        quantity: 1,
        netAmount: -200,
      }),
      m({
        transactionId: "cC",
        role: "close",
        tradeDate: opts.closedOn,
        symbol: "AVGO  260417C00220000",
        quantity: 1,
        netAmount: -50,
      }),
    ],
  };
}

describe("parseRealizedPeriod", () => {
  const now = new Date("2026-09-09T15:00:00");

  it("accepts all, ytd, and a calendar year", () => {
    assert.deepEqual(parseRealizedPeriod("all", now), { type: "all" });
    assert.deepEqual(parseRealizedPeriod("ytd", now), { type: "ytd", year: 2026, asOf: "2026-09-09" });
    assert.deepEqual(parseRealizedPeriod("2025", now), { type: "year", year: 2025 });
  });

  it("rejects junk", () => {
    assert.equal(parseRealizedPeriod("bloom", now), null);
    assert.equal(parseRealizedPeriod("199", now), null);
  });
});

describe("closedBookRealized", () => {
  it("matches tree FIFO realized for a closed AVGO strangle", () => {
    const book = avgoStrangle({ closedOn: "2026-06-15" });
    assert.equal(closedBookRealized(book), 1150);
    assert.equal(realizedEventDate(book), "2026-06-15");
  });

  it("does not treat leftover open credit as realized", () => {
    const openOnly: RealizedBookInput = {
      id: "open",
      underlying: "SPY",
      kind: "short-strangle",
      status: "open",
      linkStatus: "auto",
      closedOn: null,
      members: [
        m({ transactionId: "o", role: "open", tradeDate: "2026-08-01", symbol: "SPY 210P", quantity: -1, netAmount: 400 }),
      ],
    };
    assert.equal(closedBookRealized(openOnly), null);
  });
});

describe("aggregateClosedRealized", () => {
  const avgoYtd = avgoStrangle({ closedOn: "2026-06-15" });
  const spyPrior: RealizedBookInput = {
    id: "sit-spy",
    underlying: "SPY",
    kind: "short-strangle",
    status: "closed",
    linkStatus: "auto",
    closedOn: "2025-11-20",
    members: [
      m({ transactionId: "o", role: "open", tradeDate: "2025-10-01", symbol: "SPY 210P", quantity: -2, netAmount: 1000 }),
      m({ transactionId: "c", role: "close", tradeDate: "2025-11-20", symbol: "SPY 210P", quantity: 2, netAmount: -1200 }),
    ],
  };
  const fly: RealizedBookInput = {
    id: "sit-fly",
    underlying: "NVDA",
    kind: "butterfly",
    status: "closed",
    linkStatus: "confirmed",
    closedOn: "2026-02-01",
    members: [
      m({ transactionId: "o", role: "open", tradeDate: "2026-01-05", symbol: "NVDA fly", quantity: -1, netAmount: 150 }),
      m({ transactionId: "c", role: "close", tradeDate: "2026-02-01", symbol: "NVDA fly", quantity: 1, netAmount: -40 }),
    ],
  };
  const stillOpen = avgoStrangle({ closedOn: "2026-07-01", status: "open" });
  stillOpen.id = "sit-open";
  stillOpen.closedOn = null;
  const rejected = avgoStrangle({ closedOn: "2026-04-01", linkStatus: "rejected" });
  rejected.id = "sit-rej";

  const books = [avgoYtd, spyPrior, fly, stillOpen, rejected];

  it("all-time: closed books only, by strategy then underlying", () => {
    const summary = aggregateClosedRealized(books, { type: "all" });
    assert.equal(summary.grandTotal, 1150 + -200 + 110);
    assert.equal(summary.bookCount, 3);
    assert.equal(summary.skippedOpen, 1);
    assert.equal(summary.skippedRejected, 1);
    assert.deepEqual(summary.years, [2026, 2025]);

    const strangles = summary.strategies.find((s) => s.kind === "short-strangle");
    assert.ok(strangles);
    assert.equal(strangles.label, "Strangles");
    assert.equal(strangles.realized, 950);
    assert.equal(strangles.bookCount, 2);
    const avgo = strangles.underlyings.find((u) => u.underlying === "AVGO");
    assert.ok(avgo);
    assert.equal(avgo.realized, 1150);
    const spy = strangles.underlyings.find((u) => u.underlying === "SPY");
    assert.ok(spy);
    assert.equal(spy.realized, -200);

    const flies = summary.strategies.find((s) => s.kind === "butterfly");
    assert.ok(flies);
    assert.equal(flies.realized, 110);
    assert.equal(flies.underlyings[0]!.underlying, "NVDA");
  });

  it("YTD rolls the closed AVGO strangle in and leaves prior-year SPY out", () => {
    const summary = aggregateClosedRealized(books, { type: "ytd", year: 2026, asOf: "2026-09-09" });
    const strangles = summary.strategies.find((s) => s.kind === "short-strangle");
    assert.ok(strangles);
    assert.equal(strangles.realized, 1150);
    assert.deepEqual(
      strangles.underlyings.map((u) => u.underlying),
      ["AVGO"],
    );
    assert.equal(summary.grandTotal, 1260);
    assert.equal(summary.bookCount, 2);
  });

  it("year picker isolates 2025", () => {
    const summary = aggregateClosedRealized(books, { type: "year", year: 2025 });
    assert.equal(summary.grandTotal, -200);
    assert.equal(summary.strategies.length, 1);
    assert.equal(summary.strategies[0]!.underlyings[0]!.underlying, "SPY");
  });

  it("csv includes strategy totals and AVGO row", () => {
    const summary = aggregateClosedRealized([avgoYtd], { type: "all" });
    const csv = realizedSummaryToCsv(summary);
    assert.match(csv, /Grand total/);
    assert.match(csv, /Strangles.*"AVGO".*1150\.00/);
  });

  it("open books never enter the grand total even when FIFO could compute a step", () => {
    const rolledOpen: RealizedBookInput = {
      id: "rolled",
      underlying: "TSLA",
      kind: "short-put",
      status: "open",
      linkStatus: "auto",
      closedOn: null,
      members: [
        m({ transactionId: "o", role: "open", tradeDate: "2026-01-02", symbol: "TSLA 200P", quantity: -1, netAmount: 500 }),
        m({
          transactionId: "rc",
          role: "roll_close",
          tradeDate: "2026-03-02",
          symbol: "TSLA 200P",
          quantity: 1,
          netAmount: -200,
        }),
        m({
          transactionId: "ro",
          role: "roll_open",
          tradeDate: "2026-03-02",
          symbol: "TSLA 180P",
          quantity: -1,
          netAmount: 350,
        }),
      ],
    };
    assert.equal(closedBookRealized(rolledOpen), 300);
    const summary = aggregateClosedRealized([rolledOpen, avgoYtd], { type: "all" });
    assert.equal(summary.skippedOpen, 1);
    assert.equal(summary.grandTotal, 1150);
    assert.equal(summary.strategies.some((s) => s.kind === "short-put"), false);
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SituationMemberView } from "@/lib/situations/apiTypes";
import { allocateLegNets, expandSituationMember, optionLegSignedCash } from "@/lib/situations/expandOptionLegs";
import { closedBookRealized, type RealizedBookInput } from "@/lib/strategy/realizedByStrategy";
import { situationHeadingFigures } from "@/lib/situations/situationTree";
import type { SchwabTxnItem } from "@/lib/schwab/transactionNormalize";

function occ(root: string, yymmdd: string, right: "C" | "P", strike: number): string {
  return `${root.padEnd(6, " ")}${yymmdd}${right}${Math.round(strike * 1000).toString().padStart(8, "0")}`;
}

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

const PUT = occ("AVGO", "260417", "P", 180);
const CALL = occ("AVGO", "260417", "C", 220);

describe("allocateLegNets", () => {
  it("scales notionals to the ticket net and parks pennies on the last leg", () => {
    assert.deepEqual(allocateLegNets([800, 600], 1398.5), [799.14, 599.36]);
  });
});

describe("optionLegSignedCash", () => {
  it("uses price × qty × 100 with sell = credit", () => {
    const item: SchwabTxnItem = {
      instruction: "SELL_TO_OPEN",
      positionEffect: "OPENING",
      quantity: 1,
      price: 8,
    };
    assert.equal(optionLegSignedCash(item), 800);
  });

  it("uses Schwab cost when present", () => {
    const item: SchwabTxnItem = { cost: -200, price: 2, quantity: 1, instruction: "BUY_TO_CLOSE" };
    assert.equal(optionLegSignedCash(item), -200);
  });
});

describe("expandSituationMember", () => {
  const open = m({
    transactionId: "strangle",
    role: "open",
    tradeDate: "2026-03-01",
    symbol: PUT,
    underlying: "AVGO",
    quantity: 1,
    netAmount: 1400,
    instruction: "SELL_TO_OPEN",
    positionEffect: "OPENING",
  });
  const raw = JSON.stringify({
    activityId: 1,
    tradeDate: "2026-03-01",
    type: "TRADE",
    netAmount: 1400,
    transactionItem: [
      {
        instruction: "SELL_TO_OPEN",
        positionEffect: "OPENING",
        quantity: 1,
        price: 8,
        instrument: { symbol: PUT, underlyingSymbol: "AVGO", assetType: "OPTION" },
      },
      {
        instruction: "SELL_TO_OPEN",
        positionEffect: "OPENING",
        quantity: 1,
        price: 6,
        instrument: { symbol: CALL, underlyingSymbol: "AVGO", assetType: "OPTION" },
      },
    ],
  });

  it("leaves single-leg fills alone", () => {
    const one = m({
      transactionId: "p",
      role: "open",
      tradeDate: "2026-03-01",
      symbol: PUT,
      quantity: 1,
      netAmount: 800,
    });
    const oneRaw = JSON.stringify({
      transactionItem: [
        {
          instruction: "SELL_TO_OPEN",
          quantity: 1,
          price: 8,
          instrument: { symbol: PUT, assetType: "OPTION" },
        },
      ],
    });
    assert.equal(expandSituationMember(one, oneRaw).length, 1);
    assert.equal(expandSituationMember(one, oneRaw)[0]!.netAmount, 800);
  });

  it("splits a 2-leg strangle ticket onto both OCC symbols", () => {
    const expanded = expandSituationMember(open, raw);
    assert.equal(expanded.length, 2);
    assert.equal(expanded[0]!.symbol, PUT);
    assert.equal(expanded[0]!.transactionId, "strangle#0");
    assert.equal(expanded[0]!.netAmount, 800);
    assert.equal(expanded[1]!.symbol, CALL);
    assert.equal(expanded[1]!.transactionId, "strangle#1");
    assert.equal(expanded[1]!.netAmount, 600);
  });

  it("splits a 2-leg BTC ticket so each wing keeps its debit", () => {
    const close = m({
      transactionId: "btc",
      role: "close",
      tradeDate: "2026-03-20",
      symbol: PUT,
      quantity: 1,
      netAmount: -2200,
      instruction: "BUY_TO_CLOSE",
      positionEffect: "CLOSING",
    });
    const raw = JSON.stringify({
      netAmount: -2200,
      transactionItem: [
        {
          instruction: "BUY_TO_CLOSE",
          positionEffect: "CLOSING",
          quantity: 1,
          price: 2,
          instrument: { symbol: PUT, underlyingSymbol: "AVGO", assetType: "OPTION" },
        },
        {
          instruction: "BUY_TO_CLOSE",
          positionEffect: "CLOSING",
          quantity: 1,
          price: 20,
          instrument: { symbol: CALL, underlyingSymbol: "AVGO", assetType: "OPTION" },
        },
      ],
    });
    const expanded = expandSituationMember(close, raw);
    assert.equal(expanded.length, 2);
    assert.equal(expanded[0]!.netAmount, -200);
    assert.equal(expanded[1]!.netAmount, -2000);
    assert.equal(expanded[1]!.symbol, CALL);
  });
});

describe("same-activity strangle FIFO", () => {
  const collapsedOpen = m({
    transactionId: "strangle",
    role: "open",
    tradeDate: "2026-03-01",
    symbol: PUT,
    quantity: 1,
    netAmount: 1400,
  });
  const closePut = m({
    transactionId: "cP",
    role: "close",
    tradeDate: "2026-06-15",
    symbol: PUT,
    quantity: 1,
    netAmount: -200,
  });
  const closeCall = m({
    transactionId: "cC",
    role: "close",
    tradeDate: "2026-06-15",
    symbol: CALL,
    quantity: 1,
    netAmount: -2000,
  });

  it("FIFO cannot recover per-wing lots unless the caller expands the ticket", () => {
    const book: RealizedBookInput = {
      id: "sit",
      underlying: "AVGO",
      kind: "short-strangle",
      status: "closed",
      linkStatus: "auto",
      closedOn: "2026-06-15",
      members: [collapsedOpen, closePut, closeCall],
    };
    // Pooled +1400 on the put; call debit never matches a call lot → not −800.
    assert.notEqual(closedBookRealized(book), -800);
  });

  it("expanded members realize 800-200 + 600-2000 = −800", () => {
    const openRaw = JSON.stringify({
      netAmount: 1400,
      transactionItem: [
        {
          instruction: "SELL_TO_OPEN",
          positionEffect: "OPENING",
          quantity: 1,
          price: 8,
          instrument: { symbol: PUT, underlyingSymbol: "AVGO", assetType: "OPTION" },
        },
        {
          instruction: "SELL_TO_OPEN",
          positionEffect: "OPENING",
          quantity: 1,
          price: 6,
          instrument: { symbol: CALL, underlyingSymbol: "AVGO", assetType: "OPTION" },
        },
      ],
    });
    const members = [...expandSituationMember(collapsedOpen, openRaw), closePut, closeCall];
    const book: RealizedBookInput = {
      id: "sit",
      underlying: "AVGO",
      kind: "short-strangle",
      status: "closed",
      linkStatus: "auto",
      closedOn: "2026-06-15",
      members,
    };
    assert.equal(closedBookRealized(book), -800);
    const heading = situationHeadingFigures(members, { status: "closed" });
    assert.equal(heading.realized, -800);
  });
});

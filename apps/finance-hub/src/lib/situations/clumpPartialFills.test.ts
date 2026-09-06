import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SituationMemberView } from "@/lib/situations/apiTypes";
import { clumpPartialFills } from "@/lib/situations/clumpPartialFills";

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

describe("clumpPartialFills", () => {
  it("clumps BE order 1007714827235 16+4 into 20x close and 20x open", () => {
    const members = [
      m({
        transactionId: "c16",
        role: "roll_close",
        tradeDate: "2026-08-26",
        tradeTime: "2026-08-26T13:39:04+0000",
        orderId: "1007714827235",
        symbol: "BE    260828P00175000",
        underlying: "BE",
        right: "P",
        strike: 175,
        expiration: "2026-08-28",
        quantity: 16,
        price: 0.1,
        netAmount: -165.02,
        positionEffect: "CLOSING",
      }),
      m({
        transactionId: "o16",
        role: "roll_open",
        tradeDate: "2026-08-26",
        tradeTime: "2026-08-26T13:39:04+0000",
        orderId: "1007714827235",
        symbol: "BE    260828P00210000",
        underlying: "BE",
        right: "P",
        strike: 210,
        expiration: "2026-08-28",
        quantity: -16,
        price: 2.39,
        netAmount: 3818.84,
        positionEffect: "OPENING",
      }),
      m({
        transactionId: "c4",
        role: "roll_close",
        tradeDate: "2026-08-26",
        tradeTime: "2026-08-26T13:39:04+0000",
        orderId: "1007714827235",
        symbol: "BE    260828P00175000",
        underlying: "BE",
        right: "P",
        strike: 175,
        expiration: "2026-08-28",
        quantity: 4,
        price: 0.1,
        netAmount: -41.25,
        positionEffect: "CLOSING",
      }),
      m({
        transactionId: "o4",
        role: "roll_open",
        tradeDate: "2026-08-26",
        tradeTime: "2026-08-26T13:39:04+0000",
        orderId: "1007714827235",
        symbol: "BE    260828P00210000",
        underlying: "BE",
        right: "P",
        strike: 210,
        expiration: "2026-08-28",
        quantity: -4,
        price: 2.39,
        netAmount: 954.72,
        positionEffect: "OPENING",
      }),
    ];

    const clumped = clumpPartialFills(members);
    assert.equal(clumped.length, 2);
    const close = clumped.find((x) => x.role === "roll_close")!;
    const open = clumped.find((x) => x.role === "roll_open")!;
    assert.equal(close.quantity, 20);
    assert.equal(open.quantity, -20);
    assert.equal(close.price, 0.1);
    assert.equal(open.price, 2.39);
    assert.equal(close.netAmount, -206.27);
    assert.equal(open.netAmount, 4773.56);
    assert.match(close.transactionId, /\|/);
    assert.equal(close.orderId, "1007714827235");
  });

  it("does not clump across fills when orderId is missing", () => {
    const members = [
      m({
        transactionId: "a",
        role: "open",
        tradeDate: "2026-08-26",
        symbol: "BE    260828P00175000",
        quantity: -10,
        price: 1.0,
        netAmount: 1000,
        orderId: null,
      }),
      m({
        transactionId: "b",
        role: "open",
        tradeDate: "2026-08-26",
        symbol: "BE    260828P00175000",
        quantity: -10,
        price: 1.1,
        netAmount: 1100,
        orderId: null,
      }),
    ];
    const clumped = clumpPartialFills(members);
    assert.equal(clumped.length, 2);
  });

  it("keeps put and call separate even with same orderId", () => {
    const members = [
      m({
        transactionId: "p",
        role: "open",
        tradeDate: "2026-09-02",
        orderId: "1",
        symbol: "AVGO  260911P00350000",
        quantity: -10,
        price: 7.78,
      }),
      m({
        transactionId: "c",
        role: "open",
        tradeDate: "2026-09-02",
        orderId: "1",
        symbol: "AVGO  260911C00400000",
        quantity: -10,
        price: 6.17,
      }),
    ];
    assert.equal(clumpPartialFills(members).length, 2);
  });
});

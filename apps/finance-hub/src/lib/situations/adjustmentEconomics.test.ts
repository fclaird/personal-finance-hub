import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SituationMemberView } from "@/lib/situations/apiTypes";
import { realizedOnClosedLegs, realizedPerClosedLeg } from "@/lib/situations/adjustmentEconomics";

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

describe("adjustmentEconomics", () => {
  it("realizes gain when short put credit exceeds buyback debit", () => {
    const open = m({
      transactionId: "o",
      role: "open",
      tradeDate: "2026-08-01",
      symbol: "BE 210P",
      quantity: -20,
      netAmount: 5000,
    });
    const close = m({
      transactionId: "c",
      role: "roll_close",
      tradeDate: "2026-08-10",
      symbol: "BE 210P",
      quantity: 20,
      netAmount: -3800,
    });
    const realized = realizedOnClosedLegs([close], [open]);
    assert.equal(realized, 1200);
  });

  it("realizes per closed leg with different open credits (FIFO)", () => {
    const prior = [
      m({
        transactionId: "oP",
        role: "open",
        tradeDate: "2026-08-01",
        symbol: "BE 210P",
        quantity: -10,
        netAmount: 2000, // $200/contract
      }),
      m({
        transactionId: "oC",
        role: "open",
        tradeDate: "2026-08-01",
        symbol: "BE 225C",
        quantity: -10,
        netAmount: 1500, // $150/contract
      }),
    ];
    const closes = [
      m({
        transactionId: "cP",
        role: "roll_close",
        tradeDate: "2026-08-10",
        symbol: "BE 210P",
        quantity: 10,
        netAmount: -800,
      }),
      m({
        transactionId: "cC",
        role: "roll_close",
        tradeDate: "2026-08-10",
        symbol: "BE 225C",
        quantity: 10,
        netAmount: -1200,
      }),
    ];
    const per = realizedPerClosedLeg(closes, prior);
    assert.equal(per.length, 2);
    assert.equal(per[0]!.transactionId, "cP");
    assert.equal(per[0]!.realized, 1200); // 2000 + (-800)
    assert.equal(per[1]!.transactionId, "cC");
    assert.equal(per[1]!.realized, 300); // 1500 + (-1200)
    assert.equal(realizedOnClosedLegs(closes, prior), 1500);
  });

});

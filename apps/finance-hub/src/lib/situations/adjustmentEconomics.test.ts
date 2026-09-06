import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SituationMemberView } from "@/lib/situations/apiTypes";
import { realizedOnClosedLegs } from "@/lib/situations/adjustmentEconomics";

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

});

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SituationMemberView } from "@/lib/situations/apiTypes";
import { realizedOnClosedLegs, realizedPerClosedLeg, situationRealizedPnl } from "@/lib/situations/adjustmentEconomics";

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

  it("situationRealizedPnl sums closed-leg realized across the book", () => {
    const members = [
      m({ transactionId: "o1", role: "open", tradeDate: "2026-08-01", symbol: "BE 210P", quantity: -20, netAmount: 5000 }),
      m({ transactionId: "o2", role: "open", tradeDate: "2026-08-01", symbol: "BE 225C", quantity: -20, netAmount: 4000 }),
      m({ transactionId: "c1", role: "roll_close", tradeDate: "2026-08-10", symbol: "BE 210P", quantity: 20, netAmount: -3800 }),
      m({ transactionId: "c2", role: "roll_close", tradeDate: "2026-08-10", symbol: "BE 225C", quantity: 20, netAmount: -4500 }),
      m({ transactionId: "n1", role: "roll_open", tradeDate: "2026-08-10", symbol: "BE 235C", quantity: -20, netAmount: 3000 }),
    ];
    // put +1200, call -500 → +700
    assert.equal(situationRealizedPnl(members), 700);
  });

  it("FIFO-consumes same-symbol scale-ins so later closes do not rematch the first lot", () => {
    const open1 = m({
      transactionId: "o1",
      role: "open",
      tradeDate: "2026-03-01",
      symbol: "SPY  260417P00500000",
      quantity: -1,
      netAmount: 500,
    });
    const open2 = m({
      transactionId: "o2",
      role: "open",
      tradeDate: "2026-03-01",
      symbol: "SPY  260417P00500000",
      quantity: -1,
      netAmount: 300,
    });
    const close1 = m({
      transactionId: "c1",
      role: "close",
      tradeDate: "2026-04-01",
      symbol: "SPY  260417P00500000",
      quantity: 1,
      netAmount: -400,
    });
    const close2 = m({
      transactionId: "c2",
      role: "close",
      tradeDate: "2026-04-10",
      symbol: "SPY  260417P00500000",
      quantity: 1,
      netAmount: -100,
    });
    // Close1 vs first lot 500−400=+100; close2 vs second lot 300−100=+200.
    // Without consuming prior closes, close2 rematches the 500 lot → +400 and book +500.
    assert.equal(situationRealizedPnl([open1, open2, close1, close2]), 300);
    assert.equal(realizedOnClosedLegs([close1, close2], [open1, open2]), 300);
    const per = realizedPerClosedLeg([close2], [open1, open2, close1]);
    assert.equal(per[0]!.realized, 200);
  });

  it("does not rematch a lot already closed on an earlier roll when realizing the remainder", () => {
    const members = [
      m({
        transactionId: "o1",
        role: "open",
        tradeDate: "2026-01-02",
        symbol: "TSLA 200P",
        quantity: -1,
        netAmount: 500,
      }),
      m({
        transactionId: "o2",
        role: "open",
        tradeDate: "2026-01-02",
        symbol: "TSLA 200P",
        quantity: -1,
        netAmount: 300,
      }),
      m({
        transactionId: "rc",
        role: "roll_close",
        tradeDate: "2026-02-02",
        symbol: "TSLA 200P",
        quantity: 1,
        netAmount: -400,
      }),
      m({
        transactionId: "ro",
        role: "roll_open",
        tradeDate: "2026-02-02",
        symbol: "TSLA 180P",
        quantity: -1,
        netAmount: 350,
      }),
      m({
        transactionId: "c",
        role: "close",
        tradeDate: "2026-03-02",
        symbol: "TSLA 200P",
        quantity: 1,
        netAmount: -100,
      }),
    ];
    // Roll vs first 500 lot → +100; leftover original vs second 300 lot → +200; book +300.
    assert.equal(situationRealizedPnl(members), 300);
  });
});

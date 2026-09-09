import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SituationMemberView } from "@/lib/situations/apiTypes";
import { situationRealizedPnl } from "@/lib/situations/adjustmentEconomics";
import { buildSituationTree } from "@/lib/situations/situationTree";

function m(
  partial: Partial<SituationMemberView> & Pick<SituationMemberView, "transactionId" | "role" | "tradeDate">,
): SituationMemberView {
  return {
    tradeTime: null,
    symbol: partial.symbol ?? partial.transactionId,
    underlying: null,
    expiration: null,
    right: null,
    strike: null,
    price: null,
    quantity: null,
    positionEffect: null,
    netAmount: partial.netAmount ?? null,
    instruction: partial.instruction ?? null,
    description: partial.description ?? null,
    orderId: null,
    deltaAtFill: null,
    ...partial,
  };
}

describe("buildSituationTree", () => {
  it("roots on open and tips with current when still open", () => {
    const tree = buildSituationTree(
      [
        m({ transactionId: "o1", role: "open", tradeDate: "2026-08-01", symbol: "QQQ 695P", netAmount: 300 }),
        m({ transactionId: "o2", role: "open", tradeDate: "2026-08-01", symbol: "QQQ 735C", netAmount: 200 }),
      ],
      { status: "open" },
    );
    assert.equal(tree.length, 1);
    assert.equal(tree[0]!.kind, "open");
    // Initial open: no realized step; open credit = sum of establishing nets.
    assert.equal(tree[0]!.stepNet, null);
    assert.equal(tree[0]!.realizedToDate, null);
    assert.equal(tree[0]!.cumulativeNet, 500);
    assert.equal(tree[0]!.children[0]!.kind, "current");
    assert.equal(tree[0]!.children[0]!.cumulativeNet, 500);
    assert.equal(tree[0]!.children[0]!.realizedToDate, null);
  });

  it("nests roll_close + roll_open as an adjustment; step=realized, cum=open credit", () => {
    const tree = buildSituationTree(
      [
        m({
          transactionId: "open",
          role: "open",
          tradeDate: "2026-08-01",
          symbol: "SPCX 141C",
          quantity: -1,
          netAmount: 100,
        }),
        m({
          transactionId: "btc",
          role: "roll_close",
          tradeDate: "2026-09-03",
          symbol: "SPCX 141C",
          quantity: 1,
          netAmount: -40,
        }),
        m({
          transactionId: "sto",
          role: "roll_open",
          tradeDate: "2026-09-03",
          symbol: "SPCX 155C",
          quantity: -1,
          netAmount: 80,
        }),
        m({
          transactionId: "close",
          role: "close",
          tradeDate: "2026-09-10",
          symbol: "SPCX 155C",
          quantity: 1,
          netAmount: -20,
        }),
      ],
      { status: "closed" },
    );
    const root = tree[0]!;
    assert.equal(root.kind, "open");
    assert.equal(root.stepNet, null);
    assert.equal(root.cumulativeNet, 100);
    assert.equal(root.children.length, 1);
    const adj = root.children[0]!;
    assert.equal(adj.kind, "adjustment");
    if (adj.kind !== "adjustment") throw new Error("expected adjustment");
    // Realized on close: 100 + (-40) = 60 — not roll cash (-40+80=40).
    assert.equal(adj.stepNet, 60);
    assert.equal(adj.realizedOnClose, 60);
    assert.equal(adj.realizedToDate, 60);
    // Open credit after roll = new open premium only.
    assert.equal(adj.cumulativeNet, 80);
    assert.equal(adj.priorMembers.length, 1);
    assert.equal(adj.priorMembers[0]!.transactionId, "open");
    const close = adj.children[0]!;
    assert.equal(close.kind, "close");
    // Final close realized: 80 + (-20) = 60; open credit cleared.
    assert.equal(close.stepNet, 60);
    assert.equal(close.realizedToDate, 120);
    assert.equal(close.cumulativeNet, 0);
  });

  it("open + roll: step is realized only; cum is new open credit (not cash stack)", () => {
    // Open +$1000, buyback realizing +$200, new open +$800 → step +200, open credit +800.
    const tree = buildSituationTree(
      [
        m({
          transactionId: "open",
          role: "open",
          tradeDate: "2026-08-01",
          symbol: "BE 210P",
          quantity: -10,
          netAmount: 1000,
        }),
        m({
          transactionId: "btc",
          role: "roll_close",
          tradeDate: "2026-08-10",
          symbol: "BE 210P",
          quantity: 10,
          netAmount: -800,
        }),
        m({
          transactionId: "sto",
          role: "roll_open",
          tradeDate: "2026-08-10",
          symbol: "BE 200P",
          quantity: -10,
          netAmount: 800,
        }),
      ],
      { status: "open" },
    );
    const root = tree[0]!;
    assert.equal(root.cumulativeNet, 1000);
    assert.equal(root.stepNet, null);
    const adj = root.children[0]!;
    assert.equal(adj.kind, "adjustment");
    if (adj.kind !== "adjustment") throw new Error("expected adjustment");
    assert.equal(adj.stepNet, 200); // 1000 + (-800)
    assert.equal(adj.realizedToDate, 200);
    assert.equal(adj.cumulativeNet, 800); // not 1000-800+800 cash stack, not 1000+cash
    const tip = adj.children[0]!;
    assert.equal(tip.kind, "current");
    assert.equal(tip.cumulativeNet, 800);
    assert.equal(tip.realizedToDate, 200);
  });

  it("does not add a current tip when the situation is closed", () => {
    const tree = buildSituationTree(
      [
        m({
          transactionId: "open",
          role: "open",
          tradeDate: "2026-08-01",
          symbol: "X",
          quantity: -1,
          netAmount: 50,
        }),
        m({
          transactionId: "close",
          role: "close",
          tradeDate: "2026-08-15",
          symbol: "X",
          quantity: 1,
          netAmount: -10,
        }),
      ],
      { status: "closed" },
    );
    assert.equal(tree[0]!.children[0]!.kind, "close");
    assert.equal(tree[0]!.children[0]!.stepNet, 40); // 50 + (-10)
    assert.equal(tree[0]!.children[0]!.realizedToDate, 40);
    assert.equal(tree[0]!.children[0]!.cumulativeNet, 0);
    assert.equal(tree[0]!.children.some((c) => c.kind === "current"), false);
  });

  it("running realizedToDate sums each realized step including this one", () => {
    // Step +1000 then +500 → headings 1000 then 1500. Open credit is not in the running total.
    const tree = buildSituationTree(
      [
        m({
          transactionId: "open",
          role: "open",
          tradeDate: "2026-08-01",
          symbol: "QQQ 400P",
          quantity: -1,
          netAmount: 2000,
        }),
        m({
          transactionId: "btc1",
          role: "roll_close",
          tradeDate: "2026-08-10",
          symbol: "QQQ 400P",
          quantity: 1,
          netAmount: -1000,
        }),
        m({
          transactionId: "sto1",
          role: "roll_open",
          tradeDate: "2026-08-10",
          symbol: "QQQ 390P",
          quantity: -1,
          netAmount: 800,
        }),
        m({
          transactionId: "btc2",
          role: "roll_close",
          tradeDate: "2026-08-20",
          symbol: "QQQ 390P",
          quantity: 1,
          netAmount: -300,
        }),
        m({
          transactionId: "sto2",
          role: "roll_open",
          tradeDate: "2026-08-20",
          symbol: "QQQ 380P",
          quantity: -1,
          netAmount: 400,
        }),
      ],
      { status: "open" },
    );
    const adj1 = tree[0]!.children[0]!;
    assert.equal(adj1.kind, "adjustment");
    assert.equal(adj1.stepNet, 1000); // 2000 + (-1000)
    assert.equal(adj1.realizedToDate, 1000);
    assert.equal(adj1.cumulativeNet, 800);
    const adj2 = adj1.children[0]!;
    assert.equal(adj2.kind, "adjustment");
    assert.equal(adj2.stepNet, 500); // 800 + (-300)
    assert.equal(adj2.realizedToDate, 1500);
    assert.equal(adj2.cumulativeNet, 400);
  });

  it("leg-out then final close: later heading running total is the sum (AVGO-shaped)", () => {
    // Shape of closed AVGO 99113937: call leg-out then put close. Book net = last running total.
    const members = [
      m({
        transactionId: "openP",
        role: "open",
        tradeDate: "2026-09-02",
        symbol: "AVGO 350P",
        quantity: -10,
        netAmount: 7777,
      }),
      m({
        transactionId: "openC",
        role: "open",
        tradeDate: "2026-09-02",
        symbol: "AVGO 400C",
        quantity: -10,
        netAmount: 6167,
      }),
      m({
        transactionId: "legC",
        role: "leg",
        tradeDate: "2026-09-03",
        symbol: "AVGO 400C",
        quantity: 10,
        netAmount: -423.4,
      }),
      m({
        transactionId: "closeP",
        role: "close",
        tradeDate: "2026-09-08",
        symbol: "AVGO 350P",
        quantity: 10,
        netAmount: -1443.43,
      }),
    ];
    const tree = buildSituationTree(members, { status: "closed" });
    const root = tree[0]!;
    const leg = root.children.find((c) => c.kind === "leg");
    const close = root.children.find((c) => c.kind === "close");
    assert.ok(leg, "leg-out step");
    assert.ok(close, "final close");
    assert.equal(leg!.stepNet, 5743.6);
    assert.equal(leg!.realizedToDate, 5743.6);
    assert.equal(close!.stepNet, 6333.57);
    assert.equal(close!.realizedToDate, 12077.17);
    // Same REALIZED definition as the book — not a second P/L.
    assert.equal(close!.realizedToDate, situationRealizedPnl(members));
    const bookNet = 7777 + 6167 + -423.4 + -1443.43;
    assert.equal(close!.realizedToDate, Math.round(bookNet * 100) / 100);
  });

  it("running total goes negative when later realized steps lose more than prior gains", () => {
    const tree = buildSituationTree(
      [
        m({ transactionId: "open", role: "open", tradeDate: "2026-08-01", symbol: "IWM 220P", quantity: -1, netAmount: 400 }),
        m({
          transactionId: "btc1",
          role: "roll_close",
          tradeDate: "2026-08-10",
          symbol: "IWM 220P",
          quantity: 1,
          netAmount: -100,
        }),
        m({
          transactionId: "sto1",
          role: "roll_open",
          tradeDate: "2026-08-10",
          symbol: "IWM 210P",
          quantity: -1,
          netAmount: 200,
        }),
        m({
          transactionId: "btc2",
          role: "roll_close",
          tradeDate: "2026-08-20",
          symbol: "IWM 210P",
          quantity: 1,
          netAmount: -700,
        }),
      ],
      { status: "open" },
    );
    const adj1 = tree[0]!.children[0]!;
    assert.equal(adj1.stepNet, 300);
    assert.equal(adj1.realizedToDate, 300);
    const adj2 = adj1.children[0]!;
    assert.equal(adj2.kind, "adjustment");
    assert.equal(adj2.stepNet, -500);
    assert.equal(adj2.realizedToDate, -200);
  });
});

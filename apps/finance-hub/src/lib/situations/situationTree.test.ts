import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SituationMemberView } from "@/lib/situations/apiTypes";
import { closedFillRowNet } from "@/lib/situations/adjustmentEconomics";
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
    assert.equal(tree[0]!.cumulativeNet, 500);
    assert.equal(tree[0]!.children[0]!.kind, "current");
    assert.equal(tree[0]!.children[0]!.cumulativeNet, 500);
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
    // Open credit after roll = new open premium only.
    assert.equal(adj.cumulativeNet, 80);
    assert.equal(adj.priorMembers.length, 1);
    assert.equal(adj.priorMembers[0]!.transactionId, "open");
    const close = adj.children[0]!;
    assert.equal(close.kind, "close");
    // Final close realized: 80 + (-20) = 60; open credit cleared.
    assert.equal(close.stepNet, 60);
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
    assert.equal(adj.cumulativeNet, 800); // not 1000-800+800 cash stack, not 1000+cash
    const tip = adj.children[0]!;
    assert.equal(tip.kind, "current");
    assert.equal(tip.cumulativeNet, 800);
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
    assert.equal(tree[0]!.children[0]!.cumulativeNet, 0);
    assert.equal(tree[0]!.children.some((c) => c.kind === "current"), false);
  });

  it("sequential wing closes: fill-row net is realized G/L not the BTC debit (NVDA-shaped)", () => {
    // Closed-strangle screenshot: call BTC while put remains (leg), then put close.
    // Child fill rows must show REALIZED (green on a win), never the debit.
    const tree = buildSituationTree(
      [
        m({
          transactionId: "oC",
          role: "open",
          tradeDate: "2026-08-26",
          symbol: "NVDA 230C",
          quantity: -20,
          netAmount: 3363.61,
        }),
        m({
          transactionId: "oP",
          role: "open",
          tradeDate: "2026-08-26",
          symbol: "NVDA 200P",
          quantity: -20,
          netAmount: 5703.56,
        }),
        m({
          transactionId: "cC",
          role: "leg",
          tradeDate: "2026-08-31",
          symbol: "NVDA 230C",
          quantity: 20,
          netAmount: -1106.27,
        }),
        m({
          transactionId: "cP",
          role: "close",
          tradeDate: "2026-08-31",
          symbol: "NVDA 200P",
          quantity: 20,
          netAmount: -366.27,
        }),
      ],
      { status: "closed" },
    );
    const root = tree[0]!;
    assert.equal(root.kind, "open");
    assert.equal(root.stepNet, null);
    assert.equal(root.cumulativeNet, 9067.17);

    const callClose = root.children.find((c) => c.kind === "leg");
    assert.equal(callClose?.kind, "leg");
    if (callClose?.kind !== "leg") throw new Error("expected leg");
    assert.equal(callClose.stepNet, 2257.34);
    assert.notEqual(callClose.member.netAmount, callClose.stepNet);
    assert.equal(closedFillRowNet(callClose.member, root.members, callClose.stepNet), 2257.34);

    const putClose = root.children.find((c) => c.kind === "close");
    assert.equal(putClose?.kind, "close");
    if (putClose?.kind !== "close") throw new Error("expected close");
    assert.equal(putClose.stepNet, 5337.29);
    assert.notEqual(putClose.members[0]!.netAmount, putClose.stepNet);
    assert.equal(
      closedFillRowNet(putClose.members[0]!, putClose.priorMembers, putClose.stepNet),
      5337.29,
    );
  });

  it("grouped close fills: stepNet and per-leg display are realized, not debit sum", () => {
    const tree = buildSituationTree(
      [
        m({
          transactionId: "oC",
          role: "open",
          tradeDate: "2026-08-26",
          symbol: "NVDA 230C",
          quantity: -20,
          netAmount: 3363.61,
        }),
        m({
          transactionId: "oP",
          role: "open",
          tradeDate: "2026-08-26",
          symbol: "NVDA 200P",
          quantity: -20,
          netAmount: 5703.56,
        }),
        m({
          transactionId: "cC",
          role: "close",
          tradeDate: "2026-08-31",
          symbol: "NVDA 230C",
          quantity: 20,
          netAmount: -1106.27,
        }),
        m({
          transactionId: "cP",
          role: "close",
          tradeDate: "2026-08-31",
          symbol: "NVDA 200P",
          quantity: 20,
          netAmount: -366.27,
        }),
      ],
      { status: "closed" },
    );
    const close = tree[0]!.children[0]!;
    assert.equal(close.kind, "close");
    if (close.kind !== "close") throw new Error("expected close");
    assert.equal(close.stepNet, 7594.63);
    assert.notEqual(close.stepNet, -1472.54);
    const callShown = closedFillRowNet(close.members.find((x) => x.transactionId === "cC")!, close.priorMembers);
    const putShown = closedFillRowNet(close.members.find((x) => x.transactionId === "cP")!, close.priorMembers);
    assert.equal(callShown, 2257.34);
    assert.equal(putShown, 5337.29);
  });
});

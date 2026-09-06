import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SituationMemberView } from "@/lib/situations/apiTypes";
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
    assert.equal(tree[0]!.stepNet, 500);
    assert.equal(tree[0]!.children[0]!.kind, "current");
  });

  it("nests roll_close + roll_open as an adjustment branch with itemized nets", () => {
    const tree = buildSituationTree(
      [
        m({ transactionId: "open", role: "open", tradeDate: "2026-08-01", symbol: "SPCX 141C", netAmount: 100 }),
        m({ transactionId: "btc", role: "roll_close", tradeDate: "2026-09-03", symbol: "SPCX 141C", netAmount: -40 }),
        m({ transactionId: "sto", role: "roll_open", tradeDate: "2026-09-03", symbol: "SPCX 155C", netAmount: 80 }),
        m({ transactionId: "close", role: "close", tradeDate: "2026-09-10", symbol: "SPCX 155C", netAmount: -20 }),
      ],
      { status: "closed" },
    );
    const root = tree[0]!;
    assert.equal(root.kind, "open");
    assert.equal(root.children.length, 1);
    const adj = root.children[0]!;
    assert.equal(adj.kind, "adjustment");
    if (adj.kind !== "adjustment") throw new Error("expected adjustment");
    assert.equal(adj.stepNet, 40);
    assert.equal(adj.cumulativeNet, 140);
    assert.equal(adj.children[0]!.kind, "close");
    assert.equal(adj.children[0]!.cumulativeNet, 120);
  });

  it("does not add a current tip when the situation is closed", () => {
    const tree = buildSituationTree(
      [
        m({ transactionId: "open", role: "open", tradeDate: "2026-08-01", netAmount: 50 }),
        m({ transactionId: "close", role: "close", tradeDate: "2026-08-15", netAmount: -10 }),
      ],
      { status: "closed" },
    );
    assert.equal(tree[0]!.children[0]!.kind, "close");
    assert.equal(tree[0]!.children.some((c) => c.kind === "current"), false);
  });
});

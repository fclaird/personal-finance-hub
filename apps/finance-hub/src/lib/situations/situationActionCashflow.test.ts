import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SituationMemberView } from "@/lib/situations/apiTypes";
import { situationActionCashflow, situationActionCashflowClass } from "@/lib/situations/situationActionCashflow";
import { pnlTone, SITUATION_FILL_CASHFLOW_CLASS } from "@/lib/situations/situationPnlTone";
import { buildSituationTree, situationBlockFigures } from "@/lib/situations/situationTree";

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

describe("situationActionCashflow", () => {
  it("AVGO closed-strangle screenshot: action-row debit stays grey; REALIZED/Net stay green", () => {
    // Schwab 99113937, closed 2026-09-08 — acceptance visual for every closed book.
    const tree = buildSituationTree(
      [
        m({
          transactionId: "oP",
          role: "open",
          tradeDate: "2026-08-01",
          symbol: "AVGO 350P",
          quantity: -10,
          netAmount: 7776.69,
        }),
        m({
          transactionId: "oC",
          role: "open",
          tradeDate: "2026-08-01",
          symbol: "AVGO 400C",
          quantity: -10,
          netAmount: 6166.72,
        }),
        m({
          transactionId: "cC",
          role: "leg",
          tradeDate: "2026-09-03",
          symbol: "AVGO 400C",
          quantity: 10,
          netAmount: -423.12,
        }),
        m({
          transactionId: "cP",
          role: "close",
          tradeDate: "2026-09-08",
          symbol: "AVGO 350P",
          quantity: 10,
          netAmount: -1443.12,
        }),
      ],
      { status: "closed" },
    );
    const root = tree[0]!;
    assert.equal(root.cumulativeNet, 13943.41);
    assert.equal(pnlTone(12077.17, { realized: true }).includes("emerald"), true);

    const leg = root.children.find((c) => c.kind === "leg");
    const close = root.children.find((c) => c.kind === "close");
    if (leg?.kind !== "leg" || close?.kind !== "close") throw new Error("expected leg + close");

    assert.equal(situationActionCashflow(leg), -423.12);
    assert.equal(situationActionCashflow(close), -1443.12);
    assert.equal(situationActionCashflowClass(), SITUATION_FILL_CASHFLOW_CLASS);
    assert.equal(pnlTone(situationActionCashflow(leg), { realized: false }), SITUATION_FILL_CASHFLOW_CLASS);
    assert.equal(pnlTone(situationActionCashflow(close), { realized: false }), SITUATION_FILL_CASHFLOW_CLASS);
    assert.doesNotMatch(situationActionCashflowClass(), /emerald|red/);

    // Child fill nets are the same debit — still cashflow, not realized.
    assert.equal(leg.member.netAmount, -423.12);
    assert.equal(close.members[0]!.netAmount, -1443.12);
    assert.equal(pnlTone(leg.member.netAmount, { realized: false }), SITUATION_FILL_CASHFLOW_CLASS);
    assert.equal(pnlTone(close.members[0]!.netAmount, { realized: false }), SITUATION_FILL_CASHFLOW_CLASS);

    assert.equal(leg.stepNet, 5743.6);
    assert.equal(close.stepNet, 6333.57);
    assert.equal(leg.realizedCarry, 5743.6);
    assert.equal(close.realizedCarry, 12077.17);
    const legCol = situationBlockFigures(leg);
    assert.equal(legCol.openCredit, 7776.69);
    assert.equal(legCol.realized, 5743.6);
    assert.equal(legCol.total, 5743.6);
    assert.equal(legCol.showRealizedStep, true);
    const closeCol = situationBlockFigures(close);
    assert.equal(closeCol.openCredit, 0);
    assert.equal(closeCol.realized, 6333.57);
    assert.equal(closeCol.total, 12077.17);
    assert.equal(closeCol.showRealizedStep, true);
    assert.match(pnlTone(leg.stepNet, { realized: true }), /emerald/);
    assert.match(pnlTone(close.stepNet, { realized: true }), /emerald/);
    assert.match(pnlTone(leg.realizedCarry, { realized: true }), /emerald/);
    assert.match(pnlTone(close.realizedCarry, { realized: true }), /emerald/);
  });
});

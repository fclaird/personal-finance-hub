import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildChange, EMPTY_DRAFT } from "@/lib/fortress/composer";
import { isCurrentRun } from "@/lib/fortress/fixtures";

describe("fortress composer", () => {
  it("builds a trim, a borrow, and a simultaneous roll, and rejects a non-positive trim", () => {
    const trim = buildChange(EMPTY_DRAFT, 1);
    assert.equal(trim.ok && trim.change.op, "trimEquity");
    const borrow = buildChange({ ...EMPTY_DRAFT, op: "borrow", amount: "40000" }, 2);
    assert.equal(borrow.ok && borrow.change.op, "borrow");
    const bad = buildChange({ ...EMPTY_DRAFT, quantity: "0" }, 3);
    assert.equal(bad.ok, false);
    const roll = buildChange({ ...EMPTY_DRAFT, op: "roll", positionId: "old", quantity: "-1", price: "2" }, 4);
    assert.equal(roll.ok && roll.change.op, "roll");
    if (roll.ok && roll.change.op === "roll") assert.equal(roll.change.timing, "simultaneous");
  });

  it("ignores a stale run id", () => {
    assert.equal(isCurrentRun(2, 2), true);
    assert.equal(isCurrentRun(1, 2), false);
  });
});

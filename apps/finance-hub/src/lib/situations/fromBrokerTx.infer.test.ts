import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { inferInstructionKind } from "@/lib/situations/fromBrokerTx";

describe("inferInstructionKind", () => {
  it("maps OPENING short qty to sell_open", () => {
    assert.equal(inferInstructionKind({ positionEffect: "OPENING", quantity: -20 }), "sell_open");
  });
  it("maps CLOSING buy qty to buy_close", () => {
    assert.equal(inferInstructionKind({ positionEffect: "CLOSING", quantity: 20 }), "buy_close");
  });
  it("keeps an explicit Schwab instruction", () => {
    assert.equal(
      inferInstructionKind({ instruction: "SELL_TO_OPEN", positionEffect: "OPENING", quantity: -1 }),
      "sell_open",
    );
  });
});

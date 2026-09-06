import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { proposeSituations } from "@/lib/situations/linkSituations";
import type { LinkableTxn } from "@/lib/situations/types";

function txn(
  id: string,
  date: string,
  legs: Array<{
    symbol: string;
    underlying: string;
    expiration: string;
    right: "C" | "P";
    strike: number;
    instruction: "buy_open" | "buy_close" | "sell_open" | "sell_close";
    opening: boolean;
    quantity: number;
  }>,
  net = 0,
): LinkableTxn {
  return { id, accountId: "acct", tradeDate: date, netAmount: net, legs };
}

describe("AVGO butterfly + strangle leg-out", () => {
  it("keeps butterfly closes off the strangle and marks call takeoff as a leg", () => {
    const txns: LinkableTxn[] = [
      // Butterfly Aug 31
      txn("fly-l", "2026-08-31", [
        { symbol: "AVGO 365C", underlying: "AVGO", expiration: "2026-09-11", right: "C", strike: 365, instruction: "buy_open", opening: true, quantity: 1 },
      ], -1837),
      txn("fly-s", "2026-08-31", [
        { symbol: "AVGO 380C", underlying: "AVGO", expiration: "2026-09-11", right: "C", strike: 380, instruction: "sell_open", opening: true, quantity: -2 },
      ], 2383),
      txn("fly-h", "2026-08-31", [
        { symbol: "AVGO 395C", underlying: "AVGO", expiration: "2026-09-11", right: "C", strike: 395, instruction: "buy_open", opening: true, quantity: 1 },
      ], -737),
      // Strangle Sep 2
      txn("st-p", "2026-09-02", [
        { symbol: "AVGO 350P", underlying: "AVGO", expiration: "2026-09-11", right: "P", strike: 350, instruction: "sell_open", opening: true, quantity: -10 },
      ], 7777),
      txn("st-c", "2026-09-02", [
        { symbol: "AVGO 400C", underlying: "AVGO", expiration: "2026-09-11", right: "C", strike: 400, instruction: "sell_open", opening: true, quantity: -10 },
      ], 6167),
      // Close butterfly body + leg out strangle call Sep 3
      txn("fly-sc", "2026-09-03", [
        { symbol: "AVGO 380C", underlying: "AVGO", expiration: "2026-09-11", right: "C", strike: 380, instruction: "buy_close", opening: false, quantity: 2 },
      ], -177),
      txn("st-cc", "2026-09-03", [
        { symbol: "AVGO 400C", underlying: "AVGO", expiration: "2026-09-11", right: "C", strike: 400, instruction: "buy_close", opening: false, quantity: 10 },
      ], -423),
      // Close butterfly wings Sep 4
      txn("fly-hc", "2026-09-04", [
        { symbol: "AVGO 395C", underlying: "AVGO", expiration: "2026-09-11", right: "C", strike: 395, instruction: "sell_close", opening: false, quantity: -1 },
      ], 25),
      txn("fly-lc", "2026-09-04", [
        { symbol: "AVGO 365C", underlying: "AVGO", expiration: "2026-09-11", right: "C", strike: 365, instruction: "sell_close", opening: false, quantity: -1 },
      ], 335),
    ];

    const rows = proposeSituations(txns);
    const fly = rows.find((r) => r.kind === "butterfly");
    const st = rows.find((r) => r.kind === "short-strangle");
    assert.ok(fly, "butterfly book");
    assert.ok(st, "strangle book");
    assert.equal(fly!.members.length, 6); // 3 opens + 3 closes
    assert.equal(fly!.status, "closed");
    assert.deepEqual(
      st!.members.map((m) => m.role).sort(),
      ["leg", "open", "open"].sort(),
    );
    assert.equal(st!.status, "open");
    assert.ok(!st!.members.some((m) => m.transactionId.startsWith("fly-")));
  });
});

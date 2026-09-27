import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { proposeSituations } from "@/lib/situations/linkSituations";
import type { LinkableLeg, LinkableTxn } from "@/lib/situations/types";

function leg(partial: Partial<LinkableLeg> & Pick<LinkableLeg, "right" | "instruction">): LinkableLeg {
  return {
    symbol: partial.symbol ?? "IWM",
    underlying: partial.underlying ?? "IWM",
    expiration: partial.expiration ?? "2026-07-17",
    strike: partial.strike ?? (partial.right === "P" ? 180 : 230),
    opening: partial.opening ?? (partial.instruction === "sell_open" || partial.instruction === "buy_open"),
    quantity: partial.quantity ?? 1,
    ...partial,
  };
}

function txn(partial: Omit<LinkableTxn, "legs"> & { legs: LinkableTxn["legs"] }): LinkableTxn {
  return partial;
}

describe("proposeSituations N-transaction linking", () => {
  it("groups a same-activity short strangle with net premium", () => {
    const rows = proposeSituations([
      txn({
        id: "t1",
        accountId: "a1",
        tradeDate: "2026-06-01",
        netAmount: 420,
        legs: [
          leg({ right: "P", instruction: "sell_open", strike: 180 }),
          leg({ right: "C", instruction: "sell_open", strike: 230 }),
        ],
      }),
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.kind, "short-strangle");
    assert.equal(rows[0]!.linkStatus, "auto");
    assert.equal(rows[0]!.netPremium, 420);
    assert.equal(rows[0]!.members.length, 1);
  });

  it("links a put and call opened a day apart as a proposed strangle", () => {
    const rows = proposeSituations([
      txn({
        id: "put",
        accountId: "a1",
        tradeDate: "2026-06-01",
        netAmount: 200,
        legs: [leg({ right: "P", instruction: "sell_open", strike: 180 })],
      }),
      txn({
        id: "call",
        accountId: "a1",
        tradeDate: "2026-06-02",
        netAmount: 150,
        legs: [leg({ right: "C", instruction: "sell_open", strike: 230 })],
      }),
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.kind, "short-strangle");
    assert.equal(rows[0]!.linkStatus, "proposed");
    assert.equal(rows[0]!.netPremium, 350);
    assert.deepEqual(
      rows[0]!.members.map((m) => m.transactionId).sort(),
      ["call", "put"],
    );
  });

  it("attaches same-day BTC + STO as a roll and later BTC as a close", () => {
    const rows = proposeSituations([
      txn({
        id: "open",
        accountId: "a1",
        tradeDate: "2026-05-01",
        netAmount: 300,
        legs: [leg({ right: "P", instruction: "sell_open", strike: 180, expiration: "2026-06-20" })],
      }),
      txn({
        id: "btc",
        accountId: "a1",
        tradeDate: "2026-05-20",
        netAmount: -80,
        legs: [leg({ right: "P", instruction: "buy_close", strike: 180, expiration: "2026-06-20", opening: false })],
      }),
      txn({
        id: "sto2",
        accountId: "a1",
        tradeDate: "2026-05-20",
        netAmount: 220,
        legs: [leg({ right: "P", instruction: "sell_open", strike: 175, expiration: "2026-07-17" })],
      }),
      txn({
        id: "close",
        accountId: "a1",
        tradeDate: "2026-06-10",
        netAmount: -40,
        legs: [leg({ right: "P", instruction: "buy_close", strike: 175, expiration: "2026-07-17", opening: false })],
      }),
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.kind, "short-put");
    assert.equal(rows[0]!.status, "closed");
    assert.equal(rows[0]!.netPremium, 400);
    const roles = rows[0]!.members.map((m) => `${m.transactionId}:${m.role}`).sort();
    assert.deepEqual(roles, ["btc:roll_close", "close:close", "open:open", "sto2:roll_open"]);
  });

  it("does not re-pair a rejected put/call pair", () => {
    const rows = proposeSituations(
      [
        txn({
          id: "put",
          accountId: "a1",
          tradeDate: "2026-06-01",
          netAmount: 200,
          legs: [leg({ right: "P", instruction: "sell_open" })],
        }),
        txn({
          id: "call",
          accountId: "a1",
          tradeDate: "2026-06-01",
          netAmount: 150,
          legs: [leg({ right: "C", instruction: "sell_open" })],
        }),
      ],
      { rejectedPairs: [["put", "call"]] },
    );
    assert.equal(rows.length, 2);
    assert.ok(rows.every((r) => r.kind !== "short-strangle"));
  });

  it("classifies a 1-2-1 multi-leg as a butterfly situation", () => {
    const rows = proposeSituations([
      txn({
        id: "fly",
        accountId: "a1",
        tradeDate: "2026-06-01",
        netAmount: -150,
        legs: [
          leg({ right: "C", instruction: "buy_open", strike: 500, quantity: 1 }),
          leg({ right: "C", instruction: "sell_open", strike: 520, quantity: 2 }),
          leg({ right: "C", instruction: "buy_open", strike: 540, quantity: 1 }),
        ],
      }),
    ]);
    assert.equal(rows[0]!.kind, "butterfly");
  });

  it("attaches a same-activity two-leg close onto the open strangle", () => {
    const rows = proposeSituations([
      txn({
        id: "open",
        accountId: "a1",
        tradeDate: "2026-06-01",
        netAmount: 420,
        legs: [
          leg({ right: "P", instruction: "sell_open", strike: 180, expiration: "2026-07-17" }),
          leg({ right: "C", instruction: "sell_open", strike: 230, expiration: "2026-07-17" }),
        ],
      }),
      txn({
        id: "close",
        accountId: "a1",
        tradeDate: "2026-06-20",
        netAmount: -80,
        legs: [
          leg({ right: "P", instruction: "buy_close", strike: 180, expiration: "2026-07-17", opening: false }),
          leg({ right: "C", instruction: "buy_close", strike: 230, expiration: "2026-07-17", opening: false }),
        ],
      }),
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.status, "closed");
    assert.equal(rows[0]!.netPremium, 340);
    assert.ok(rows[0]!.members.some((m) => m.transactionId === "close" && m.role === "close"));
  });

  it("attaches a LEAP close after the 45-day short-premium window", () => {
    const rows = proposeSituations([
      txn({
        id: "open",
        accountId: "a1",
        tradeDate: "2026-01-05",
        netAmount: -4500,
        legs: [leg({ right: "C", instruction: "buy_open", strike: 200, expiration: "2027-01-15", quantity: 1 })],
      }),
      txn({
        id: "close",
        accountId: "a1",
        tradeDate: "2026-08-10",
        netAmount: 6200,
        legs: [
          leg({
            right: "C",
            instruction: "sell_close",
            strike: 200,
            expiration: "2027-01-15",
            opening: false,
            quantity: 1,
          }),
        ],
      }),
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.kind, "leap");
    assert.equal(rows[0]!.status, "closed");
    assert.equal(rows[0]!.netPremium, 1700);
  });

  it("attaches a roll to the matching expiration, not the nearest same strike", () => {
    const rows = proposeSituations([
      txn({
        id: "jul",
        accountId: "a1",
        tradeDate: "2026-06-01",
        netAmount: 200,
        orderId: "1",
        legs: [leg({ right: "P", instruction: "sell_open", strike: 180, expiration: "2026-07-17" })],
      }),
      txn({
        id: "aug",
        accountId: "a1",
        tradeDate: "2026-06-10",
        netAmount: 180,
        orderId: "2",
        legs: [leg({ right: "P", instruction: "sell_open", strike: 180, expiration: "2026-08-21" })],
      }),
      txn({
        id: "btc-jul",
        accountId: "a1",
        tradeDate: "2026-06-20",
        netAmount: -40,
        orderId: "3",
        legs: [leg({ right: "P", instruction: "buy_close", strike: 180, expiration: "2026-07-17", opening: false })],
      }),
      txn({
        id: "sto-sep",
        accountId: "a1",
        tradeDate: "2026-06-20",
        netAmount: 90,
        orderId: "3",
        legs: [leg({ right: "P", instruction: "sell_open", strike: 175, expiration: "2026-09-18" })],
      }),
    ]);
    const jul = rows.find((r) => r.members.some((m) => m.transactionId === "jul"));
    assert.ok(jul?.members.some((m) => m.transactionId === "btc-jul"));
    assert.equal(jul?.members.some((m) => m.transactionId === "aug"), false);
  });

  it("does not drop a same-day extra short sold after a same-order put roll", () => {
    const rows = proposeSituations([
      txn({
        id: "open-put",
        accountId: "a1",
        tradeDate: "2026-05-01",
        netAmount: 300,
        orderId: "1",
        legs: [leg({ right: "P", instruction: "sell_open", strike: 180, expiration: "2026-06-20" })],
      }),
      txn({
        id: "btc",
        accountId: "a1",
        tradeDate: "2026-05-20",
        netAmount: -80,
        orderId: "2",
        legs: [leg({ right: "P", instruction: "buy_close", strike: 180, expiration: "2026-06-20", opening: false })],
      }),
      txn({
        id: "sto2",
        accountId: "a1",
        tradeDate: "2026-05-20",
        netAmount: 220,
        orderId: "2",
        legs: [leg({ right: "P", instruction: "sell_open", strike: 175, expiration: "2026-07-17" })],
      }),
      txn({
        id: "sto-call",
        accountId: "a1",
        tradeDate: "2026-05-20",
        netAmount: 150,
        orderId: "3",
        legs: [leg({ right: "C", instruction: "sell_open", strike: 230, expiration: "2026-07-17" })],
      }),
    ]);
    const ids = rows.flatMap((r) => r.members.map((m) => m.transactionId));
    assert.ok(ids.includes("sto-call"));
  });
});

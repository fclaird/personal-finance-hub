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

  it("rolls the older same-strike put, not the nearer-dated overlapping book", () => {
    const rows = proposeSituations([
      txn({
        id: "open1",
        accountId: "a1",
        tradeDate: "2026-06-01",
        netAmount: 300,
        legs: [leg({ symbol: "IWM 180P JUL", right: "P", instruction: "sell_open", strike: 180, expiration: "2026-07-17" })],
      }),
      txn({
        id: "open2",
        accountId: "a1",
        tradeDate: "2026-06-10",
        netAmount: 280,
        legs: [leg({ symbol: "IWM 180P AUG", right: "P", instruction: "sell_open", strike: 180, expiration: "2026-08-21" })],
      }),
      txn({
        id: "roll-close",
        accountId: "a1",
        tradeDate: "2026-06-20",
        netAmount: -80,
        orderId: "roll-jul",
        legs: [
          leg({
            symbol: "IWM 180P JUL",
            right: "P",
            instruction: "buy_close",
            strike: 180,
            expiration: "2026-07-17",
            opening: false,
          }),
        ],
      }),
      txn({
        id: "roll-open",
        accountId: "a1",
        tradeDate: "2026-06-20",
        netAmount: 220,
        orderId: "roll-jul",
        legs: [leg({ symbol: "IWM 175P AUG", right: "P", instruction: "sell_open", strike: 175, expiration: "2026-08-21" })],
      }),
    ]);
    const jul = rows.find((r) => r.members.some((m) => m.transactionId === "open1"));
    const aug = rows.find((r) => r.members.some((m) => m.transactionId === "open2"));
    assert.ok(jul, "June 1 book");
    assert.ok(aug, "June 10 book");
    assert.notEqual(jul, aug);
    assert.deepEqual(
      jul!.members.map((m) => `${m.transactionId}:${m.role}`).sort(),
      ["open1:open", "roll-close:roll_close", "roll-open:roll_open"],
    );
    assert.deepEqual(
      aug!.members.map((m) => `${m.transactionId}:${m.role}`),
      ["open2:open"],
    );
  });

  it("attaches a two-wing roll to the book that uniquely holds the call strike", () => {
    const rows = proposeSituations([
      txn({
        id: "s1-p",
        accountId: "a1",
        tradeDate: "2026-06-01",
        netAmount: 200,
        legs: [leg({ symbol: "IWM 180P", right: "P", instruction: "sell_open", strike: 180, expiration: "2026-07-17" })],
      }),
      txn({
        id: "s1-c",
        accountId: "a1",
        tradeDate: "2026-06-01",
        netAmount: 180,
        legs: [leg({ symbol: "IWM 230C", right: "C", instruction: "sell_open", strike: 230, expiration: "2026-07-17" })],
      }),
      txn({
        id: "s2-p",
        accountId: "a1",
        tradeDate: "2026-06-05",
        netAmount: 190,
        legs: [leg({ symbol: "IWM 180P", right: "P", instruction: "sell_open", strike: 180, expiration: "2026-07-17" })],
      }),
      txn({
        id: "s2-c",
        accountId: "a1",
        tradeDate: "2026-06-05",
        netAmount: 170,
        legs: [leg({ symbol: "IWM 240C", right: "C", instruction: "sell_open", strike: 240, expiration: "2026-07-17" })],
      }),
      // Put close id sorts first so first-match findBookForAnyClose would steal onto the nearer Jun 5 book.
      txn({
        id: "aaa-close-put",
        accountId: "a1",
        tradeDate: "2026-06-20",
        netAmount: -90,
        orderId: "roll-s1",
        legs: [
          leg({
            symbol: "IWM 180P",
            right: "P",
            instruction: "buy_close",
            strike: 180,
            expiration: "2026-07-17",
            opening: false,
          }),
        ],
      }),
      txn({
        id: "zzz-close-call",
        accountId: "a1",
        tradeDate: "2026-06-20",
        netAmount: -70,
        orderId: "roll-s1",
        legs: [
          leg({
            symbol: "IWM 230C",
            right: "C",
            instruction: "buy_close",
            strike: 230,
            expiration: "2026-07-17",
            opening: false,
          }),
        ],
      }),
      txn({
        id: "roll-s1-open-p",
        accountId: "a1",
        tradeDate: "2026-06-20",
        netAmount: 210,
        orderId: "roll-s1",
        legs: [leg({ symbol: "IWM 175P", right: "P", instruction: "sell_open", strike: 175, expiration: "2026-08-21" })],
      }),
      txn({
        id: "roll-s1-open-c",
        accountId: "a1",
        tradeDate: "2026-06-20",
        netAmount: 160,
        orderId: "roll-s1",
        legs: [leg({ symbol: "IWM 235C", right: "C", instruction: "sell_open", strike: 235, expiration: "2026-08-21" })],
      }),
    ]);
    const s1 = rows.find((r) => r.members.some((m) => m.transactionId === "s1-p"));
    const s2 = rows.find((r) => r.members.some((m) => m.transactionId === "s2-p"));
    assert.ok(s1, "June 1 strangle");
    assert.ok(s2, "June 5 strangle");
    const s1Ids = s1!.members.map((m) => m.transactionId).sort();
    assert.ok(s1Ids.includes("aaa-close-put"));
    assert.ok(s1Ids.includes("zzz-close-call"));
    assert.ok(s1Ids.includes("roll-s1-open-p"));
    assert.ok(s1Ids.includes("roll-s1-open-c"));
    assert.deepEqual(
      s2!.members.map((m) => m.transactionId).sort(),
      ["s2-c", "s2-p"],
    );
  });
});

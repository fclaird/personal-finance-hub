import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { clumpLinkablePartials } from "@/lib/situations/fromBrokerTx";
import type { LinkableTxn } from "@/lib/situations/types";

function txn(partial: Partial<LinkableTxn> & Pick<LinkableTxn, "id" | "legs">): LinkableTxn {
  return {
    accountId: "acct",
    tradeDate: "2026-09-03",
    netAmount: 0,
    orderId: null,
    tradeTime: null,
    price: null,
    sourceTransactionIds: [partial.id],
    ...partial,
  };
}

describe("clumpLinkablePartials", () => {
  it("merges 17+3 same orderId + symbol opens into one 20-lot txn", () => {
    const rows = clumpLinkablePartials([
      txn({
        id: "a",
        orderId: "1007816464950",
        tradeTime: "2026-09-03T15:28:28+0000",
        netAmount: 4651.95,
        price: 15.51,
        legs: [
          {
            symbol: "BE    260918P00230000",
            underlying: "BE",
            expiration: "2026-09-18",
            right: "P",
            strike: 230,
            instruction: "sell_open",
            opening: true,
            quantity: -3,
          },
        ],
      }),
      txn({
        id: "b",
        orderId: "1007816464950",
        tradeTime: "2026-09-03T15:28:29+0000",
        netAmount: 26344.1,
        price: 15.5,
        legs: [
          {
            symbol: "BE    260918P00230000",
            underlying: "BE",
            expiration: "2026-09-18",
            right: "P",
            strike: 230,
            instruction: "sell_open",
            opening: true,
            quantity: -17,
          },
        ],
      }),
      txn({
        id: "c",
        orderId: "1007816464950",
        tradeTime: "2026-09-03T15:28:28+0000",
        netAmount: 3736.97,
        price: 12.46,
        legs: [
          {
            symbol: "BE    260918C00245000",
            underlying: "BE",
            expiration: "2026-09-18",
            right: "C",
            strike: 245,
            instruction: "sell_open",
            opening: true,
            quantity: -3,
          },
        ],
      }),
      txn({
        id: "d",
        orderId: "1007816464950",
        tradeTime: "2026-09-03T15:28:29+0000",
        netAmount: 21159.21,
        price: 12.45,
        legs: [
          {
            symbol: "BE    260918C00245000",
            underlying: "BE",
            expiration: "2026-09-18",
            right: "C",
            strike: 245,
            instruction: "sell_open",
            opening: true,
            quantity: -17,
          },
        ],
      }),
    ]);

    assert.equal(rows.length, 2);
    const put = rows.find((t) => t.legs[0]?.right === "P")!;
    const call = rows.find((t) => t.legs[0]?.right === "C")!;
    assert.equal(put.legs[0]!.quantity, -20);
    assert.equal(call.legs[0]!.quantity, -20);
    assert.deepEqual(put.sourceTransactionIds?.slice().sort(), ["a", "b"]);
    assert.deepEqual(call.sourceTransactionIds?.slice().sort(), ["c", "d"]);
    assert.equal(put.netAmount, 30996.05);
    assert.equal(call.netAmount, 24896.18);
  });

  it("does not clump when orderId is missing", () => {
    const rows = clumpLinkablePartials([
      txn({
        id: "x",
        orderId: null,
        legs: [
          {
            symbol: "BE P",
            underlying: "BE",
            expiration: "2026-09-18",
            right: "P",
            strike: 230,
            instruction: "sell_open",
            opening: true,
            quantity: -3,
          },
        ],
      }),
      txn({
        id: "y",
        orderId: null,
        legs: [
          {
            symbol: "BE P",
            underlying: "BE",
            expiration: "2026-09-18",
            right: "P",
            strike: 230,
            instruction: "sell_open",
            opening: true,
            quantity: -17,
          },
        ],
      }),
    ]);
    assert.equal(rows.length, 2);
  });
});

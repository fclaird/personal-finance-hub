import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SCHWAB_REFRESH_TRANSACTION_LOOKBACK_DAYS, SCHWAB_TRANSACTION_CHUNK_DAYS } from "./config";
import {
  fetchSchwabTransactionsChunked,
  schwabTransactionChunkWindows,
} from "./fetchAccountTransactions";
import type { SchwabTxnRaw } from "./transactionNormalize";

function addCalendarDays(iso: string, deltaDays: number): string {
  const y = Number(iso.slice(0, 4));
  const mo = Number(iso.slice(5, 7));
  const d = Number(iso.slice(8, 10));
  return new Date(Date.UTC(y, mo - 1, d) + deltaDays * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

describe("schwabTransactionChunkWindows", () => {
  it("keeps the 14-day scheduler lookback as one chunk-sized window", () => {
    const endCap = "2020-06-15";
    const windows = schwabTransactionChunkWindows(endCap, SCHWAB_REFRESH_TRANSACTION_LOOKBACK_DAYS);
    assert.equal(SCHWAB_REFRESH_TRANSACTION_LOOKBACK_DAYS, 14);
    assert.equal(windows.length, 1);
    assert.equal(windows[0]?.end, endCap);
    assert.equal(windows[0]?.start, addCalendarDays(endCap, -SCHWAB_TRANSACTION_CHUNK_DAYS));
  });
});

describe("fetchSchwabTransactionsChunked", () => {
  it("does not accumulate every chunk into one array", async () => {
    const endCap = "2020-06-15";
    const chunkDays = 10;
    const lookbackDays = 25;
    const windows = schwabTransactionChunkWindows(endCap, lookbackDays, chunkDays);
    assert.equal(windows.length, 3);

    const calls: string[] = [];
    const delivered: SchwabTxnRaw[][] = [];
    let callbackActive = false;

    const result = await fetchSchwabTransactionsChunked(
      "hash",
      lookbackDays,
      async (batch) => {
        assert.equal(callbackActive, false);
        callbackActive = true;
        delivered.push(batch);
        await Promise.resolve();
        callbackActive = false;
      },
      {
        endCapIso: endCap,
        chunkDays,
        fetchWindow: async (_hash, start, end, max) => {
          assert.equal(callbackActive, false);
          assert.equal(max, endCap);
          calls.push(`${start}..${end}`);
          const n = calls.length;
          if (n === 1) return [{ activityId: 10, tradeDate: end, type: "TRADE" }];
          if (n === 2) {
            return [
              { activityId: 20, tradeDate: end, type: "TRADE" },
              { activityId: 10, tradeDate: end, type: "TRADE" },
            ];
          }
          return [{ activityId: 20, tradeDate: end, type: "TRADE" }];
        },
      },
    );

    assert.deepEqual(
      calls,
      windows.map((w) => `${w.start}..${w.end}`),
    );
    assert.equal(delivered.length, windows.length);
    assert.equal(new Set(delivered).size, delivered.length);
    assert.deepEqual(
      delivered.map((batch) => batch.map((tx) => tx.activityId)),
      [[10], [20], []],
    );
    const totalDelivered = delivered.reduce((n, batch) => n + batch.length, 0);
    assert.equal(totalDelivered, 2);
    assert.ok(delivered.every((batch) => batch.length <= 1));
    assert.deepEqual(result, { chunks: 3 });
  });
});

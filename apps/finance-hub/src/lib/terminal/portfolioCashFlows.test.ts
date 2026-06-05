import assert from "node:assert/strict";
import test from "node:test";

import {
  portfolioDailyReturnPct,
  resolveSchwabAccountHashMap,
  SCHWAB_CASH_FLOW_TRANSACTION_TYPES,
} from "@/lib/terminal/portfolioCashFlows";

test("portfolioDailyReturnPct adds back withdrawals (negative net cash flow)", () => {
  const prior = 4_958_143.56;
  const current = 4_969_238.66;
  const withdrawal = -50_000;
  const raw = portfolioDailyReturnPct(current, prior, 0);
  const adjusted = portfolioDailyReturnPct(current, prior, withdrawal);
  assert.ok(raw != null && raw < 0.5);
  assert.ok(adjusted != null && adjusted > 1.1 && adjusted < 1.4);
});

test("portfolioDailyReturnPct subtracts deposits from day return", () => {
  const prior = 1_000_000;
  const current = 1_030_000;
  const deposit = 25_000;
  const adjusted = portfolioDailyReturnPct(current, prior, deposit);
  assert.ok(adjusted != null && Math.abs(adjusted - 0.5) < 0.01);
});

test("SCHWAB_CASH_FLOW_TRANSACTION_TYPES excludes TRADE", () => {
  assert.equal(SCHWAB_CASH_FLOW_TRANSACTION_TYPES.includes("TRADE" as never), false);
});

test("resolveSchwabAccountHashMap matches accountId-based rows by synced account name", () => {
  const hashes = resolveSchwabAccountHashMap(
    [
      {
        id: "schwab_ABC123ACCOUNTID",
        name: "Schwab 11112222",
        schwab_account_hash: null,
      },
    ],
    [{ accountNumber: "11112222", hashValue: "hash-for-transactions" }],
  );

  assert.equal(hashes.get("schwab_ABC123ACCOUNTID"), "hash-for-transactions");
});

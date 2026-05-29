import type Database from "better-sqlite3";

import { isAuroraExclusiveAccountId } from "@/lib/auroraExclusive";
import { getDb } from "@/lib/db";
import { pickEquityUsd, pickSchwabPriorDayEquityUsd } from "@/lib/schwab/accountBalances";
import { schwabFetch } from "@/lib/schwab/client";

type SchwabAccount = {
  securitiesAccount: {
    accountId: string;
    accountNumber?: string;
    currentBalances?: Record<string, unknown>;
  };
};

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function pickCashUsd(cb: Record<string, unknown> | undefined): number | null {
  if (!cb) return null;
  const keys = [
    "cashBalance",
    "cashAvailableForTrading",
    "cashAvailableForWithdrawal",
    "availableFundsNonMarginableTrade",
    "availableFunds",
    "moneyMarketFund",
    "sweepVehicle",
  ];
  for (const k of keys) {
    const n = asNumber(cb[k]);
    if (n != null) return n;
  }
  return null;
}

export type SchwabAccountValueSyncResult = {
  ok: boolean;
  wrote: number;
  error?: string;
};

export async function runSchwabAccountValueSync(db?: Database.Database): Promise<SchwabAccountValueSyncResult> {
  const database = db ?? getDb();
  try {
    const accounts = await schwabFetch<SchwabAccount[]>("accounts");
    const nowIso = new Date().toISOString();

    const upsert = database.prepare(`
      INSERT INTO account_value_points (account_id, as_of, equity_value, cash_value, prior_equity_value, source)
      VALUES (@account_id, @as_of, @equity_value, @cash_value, @prior_equity_value, 'schwab_balances')
      ON CONFLICT(account_id, as_of) DO UPDATE SET
        equity_value = excluded.equity_value,
        cash_value = excluded.cash_value,
        prior_equity_value = excluded.prior_equity_value
    `);

    let wrote = 0;
    const tx = database.transaction(() => {
      for (const a of accounts) {
        const sa = a.securitiesAccount;
        const acctIdPart =
          (sa.accountId != null && String(sa.accountId).trim() !== "" ? String(sa.accountId) : null) ??
          (sa.accountNumber != null && String(sa.accountNumber).trim() !== "" ? String(sa.accountNumber) : null);
        if (!acctIdPart) continue;
        const accountId = `schwab_${acctIdPart}`;
        if (isAuroraExclusiveAccountId(accountId)) continue;
        const cash = pickCashUsd(sa.currentBalances);
        const equity = pickEquityUsd(sa.currentBalances);
        const priorEquity = pickSchwabPriorDayEquityUsd(sa.currentBalances);
        if (equity == null || !Number.isFinite(equity)) continue;
        upsert.run({
          account_id: accountId,
          as_of: nowIso,
          equity_value: equity,
          cash_value: cash,
          prior_equity_value: priorEquity,
        });
        wrote += 1;
      }
    });
    tx();

    return { ok: true, wrote };
  } catch (e) {
    return { ok: false, wrote: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

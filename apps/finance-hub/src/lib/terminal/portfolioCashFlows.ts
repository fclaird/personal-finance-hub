import type Database from "better-sqlite3";

import { allSyncedAccountsWhereSql } from "@/lib/holdings/latestSnapshots";
import {
  fetchSchwabTransactionsWindow,
  schwabCalendarTodayIso,
} from "@/lib/schwab/fetchAccountTransactions";
import { tradeDateIso, type SchwabTxnRaw } from "@/lib/schwab/transactionNormalize";

/** Schwab transaction types that move cash in/out of the portfolio (not market P&L). */
export const SCHWAB_CASH_FLOW_TRANSACTION_TYPES = [
  "ACH_RECEIPT",
  "ACH_DISBURSEMENT",
  "CASH_RECEIPT",
  "CASH_DISBURSEMENT",
  "ELECTRONIC_FUND",
  "WIRE_IN",
  "WIRE_OUT",
] as const;

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function activityKey(hash: string, tx: SchwabTxnRaw): string {
  const id = tx.activityId ?? tx.transactionId;
  if (id != null && Number.isFinite(Number(id))) return `${hash}:${id}`;
  return `${hash}:${JSON.stringify(tx).slice(0, 120)}`;
}

/**
 * Sum of Schwab `netAmount` for external cash flows on `sessionYmd` (NY calendar day).
 * Negative total = net withdrawals; positive = net deposits.
 */
export async function fetchSchwabSessionNetCashFlow(
  sessionYmd: string,
  db: Database.Database,
): Promise<number> {
  const rows = db
    .prepare(
      `
      SELECT schwab_account_hash AS hash
      FROM accounts a
      WHERE a.id LIKE 'schwab_%'
        AND schwab_account_hash IS NOT NULL
        AND TRIM(schwab_account_hash) != ''
        AND ${allSyncedAccountsWhereSql("a")}
    `,
    )
    .all() as Array<{ hash: string }>;

  if (rows.length === 0) return 0;

  const endCap = sessionYmd <= schwabCalendarTodayIso() ? sessionYmd : schwabCalendarTodayIso();
  const seen = new Set<string>();
  let total = 0;

  for (const { hash } of rows) {
    for (const type of SCHWAB_CASH_FLOW_TRANSACTION_TYPES) {
      const txs = await fetchSchwabTransactionsWindow(hash, sessionYmd, sessionYmd, endCap, type);
      for (const tx of txs) {
        const key = activityKey(hash, tx);
        if (seen.has(key)) continue;
        seen.add(key);
        const date = tradeDateIso(tx);
        if (date !== sessionYmd) continue;
        const net = asNumber(tx.netAmount);
        if (net == null) continue;
        total += net;
      }
    }
  }

  return total;
}

/** Day return % that excludes deposits and withdrawals (TWR-style for a single session). */
export function portfolioDailyReturnPct(
  netValue: number,
  priorNetValue: number,
  netCashFlow = 0,
): number | null {
  if (priorNetValue <= 0 || netValue <= 0 || !Number.isFinite(netValue) || !Number.isFinite(priorNetValue)) {
    return null;
  }
  const flow = Number.isFinite(netCashFlow) ? netCashFlow : 0;
  return ((netValue - flow) / priorNetValue - 1) * 100;
}

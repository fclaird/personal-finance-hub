import type Database from "better-sqlite3";

import { allSyncedAccountsWhereSql } from "@/lib/holdings/latestSnapshots";
import {
  fetchSchwabAccountNumbers,
  fetchSchwabTransactionsWindow,
  type SchwabAccountNumberRow,
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

type SchwabAccountHashRow = {
  id: string;
  name: string | null;
  schwab_account_hash: string | null;
};

function cleanString(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  return s ? s : null;
}

export function resolveSchwabAccountHashMap(
  accounts: SchwabAccountHashRow[],
  accountNumbers: SchwabAccountNumberRow[],
): Map<string, string> {
  const out = new Map<string, string>();
  for (const account of accounts) {
    const hash = cleanString(account.schwab_account_hash);
    if (hash) out.set(account.id, hash);
  }

  for (const ref of accountNumbers) {
    const num = cleanString(ref.accountNumber);
    const hash = cleanString(ref.hashValue);
    if (!num || !hash) continue;
    const directId = `schwab_${num}`;
    const generatedName = `Schwab ${num}`;
    const account = accounts.find(
      (candidate) => candidate.id === directId || cleanString(candidate.name) === generatedName,
    );
    if (account) out.set(account.id, hash);
  }

  return out;
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
      SELECT id, name, schwab_account_hash
      FROM accounts a
      WHERE a.id LIKE 'schwab_%'
        AND ${allSyncedAccountsWhereSql("a")}
    `,
    )
    .all() as SchwabAccountHashRow[];

  if (rows.length === 0) return 0;

  let accountNumbers: SchwabAccountNumberRow[] = [];
  if (rows.some((row) => !cleanString(row.schwab_account_hash))) {
    try {
      accountNumbers = await fetchSchwabAccountNumbers();
    } catch {
      accountNumbers = [];
    }
  }

  const hashByAccountId = resolveSchwabAccountHashMap(rows, accountNumbers);
  if (accountNumbers.length > 0) {
    const updateHash = db.prepare(
      `UPDATE accounts SET schwab_account_hash = @hash, updated_at = datetime('now') WHERE id = @id`,
    );
    for (const row of rows) {
      const hash = hashByAccountId.get(row.id);
      if (hash && hash !== cleanString(row.schwab_account_hash)) updateHash.run({ id: row.id, hash });
    }
  }

  const hashes = [...new Set(hashByAccountId.values())];
  if (hashes.length === 0) return 0;

  const endCap = sessionYmd <= schwabCalendarTodayIso() ? sessionYmd : schwabCalendarTodayIso();
  const seen = new Set<string>();
  let total = 0;

  for (const hash of hashes) {
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

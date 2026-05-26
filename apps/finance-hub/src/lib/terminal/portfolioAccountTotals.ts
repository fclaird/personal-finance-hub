import type Database from "better-sqlite3";

import { getDb } from "@/lib/db";
import { allSyncedAccountsWhereSql, latestSnapshotPerAccountJoinSql } from "@/lib/holdings/latestSnapshots";
import { POSITION_MARKET_VALUE_SQL } from "@/lib/holdings/positionMarketValue";
import { isAuroraExclusiveAccountId } from "@/lib/auroraExclusive";
import { isoDateInUsEastern } from "@/lib/market/glanceSession";
import { pickEquityUsd, pickPriorEquityUsd } from "@/lib/schwab/accountBalances";
import { schwabFetch } from "@/lib/schwab/client";

type SchwabAccountPayload = {
  securitiesAccount: {
    accountId?: string;
    accountNumber?: string;
    currentBalances?: Record<string, unknown>;
  };
};

export type PortfolioAccountTotals = {
  netValue: number;
  priorNetValue: number;
  schwabCurrent: number;
  schwabPrior: number;
  externalCurrent: number;
  externalPrior: number;
  source: "schwab_live" | "schwab_db";
};

function schwabAccountId(sa: SchwabAccountPayload["securitiesAccount"]): string | null {
  const acctIdPart =
    (sa.accountId != null && String(sa.accountId).trim() !== "" ? String(sa.accountId) : null) ??
    (sa.accountNumber != null && String(sa.accountNumber).trim() !== "" ? String(sa.accountNumber) : null);
  if (!acctIdPart) return null;
  const accountId = `schwab_${acctIdPart}`;
  if (isAuroraExclusiveAccountId(accountId)) return null;
  return accountId;
}

/** Sum latest Schwab liquidation values stored from sync. */
export function schwabLiquidationFromDb(db: Database.Database): { current: number; byAccount: Map<string, number> } {
  const rows = db
    .prepare(
      `
      SELECT av.account_id AS account_id, av.equity_value AS equity_value
      FROM account_value_points av
      JOIN accounts a ON a.id = av.account_id
      JOIN (
        SELECT account_id, MAX(as_of) AS max_as_of
        FROM account_value_points
        GROUP BY account_id
      ) latest ON latest.account_id = av.account_id AND latest.max_as_of = av.as_of
      WHERE a.id LIKE 'schwab_%' AND ${allSyncedAccountsWhereSql("a")}
    `,
    )
    .all() as Array<{ account_id: string; equity_value: number }>;

  const byAccount = new Map<string, number>();
  let current = 0;
  for (const row of rows) {
    const v = row.equity_value;
    if (!Number.isFinite(v)) continue;
    byAccount.set(row.account_id, v);
    current += v;
  }
  return { current, byAccount };
}

/** Last stored Schwab liquidation per account on or before a session date (NY). */
export function schwabPriorLiquidationFromDb(
  db: Database.Database,
  sessionYmd: string,
): { prior: number; byAccount: Map<string, number> } {
  const rows = db
    .prepare(
      `
      SELECT av.account_id AS account_id, av.equity_value AS equity_value
      FROM account_value_points av
      JOIN accounts a ON a.id = av.account_id
      JOIN (
        SELECT account_id, MAX(as_of) AS max_as_of
        FROM account_value_points
        WHERE date(as_of) <= @session_ymd
        GROUP BY account_id
      ) prior ON prior.account_id = av.account_id AND prior.max_as_of = av.as_of
      WHERE a.id LIKE 'schwab_%' AND ${allSyncedAccountsWhereSql("a")}
    `,
    )
    .all({ session_ymd: sessionYmd }) as Array<{ account_id: string; equity_value: number }>;

  const byAccount = new Map<string, number>();
  let prior = 0;
  for (const row of rows) {
    const v = row.equity_value;
    if (!Number.isFinite(v)) continue;
    byAccount.set(row.account_id, v);
    prior += v;
  }
  return { prior, byAccount };
}

/** Manual, Plaid, and other non-Schwab accounts from latest holding snapshots. */
export function externalMarketValueFromDb(db: Database.Database, priorSessionYmd: string): {
  current: number;
  prior: number;
} {
  const currentRow = db
    .prepare(
      `
      SELECT COALESCE(SUM(${POSITION_MARKET_VALUE_SQL}), 0) AS mv
      FROM holding_snapshots hs
      JOIN accounts a ON a.id = hs.account_id
      ${latestSnapshotPerAccountJoinSql("hs")}
      JOIN positions p ON p.snapshot_id = hs.id
      WHERE a.id NOT LIKE 'schwab_%'
        AND ${allSyncedAccountsWhereSql("a")}
    `,
    )
    .get() as { mv: number } | undefined;

  const priorRow = db
    .prepare(
      `
      SELECT COALESCE(SUM(${POSITION_MARKET_VALUE_SQL}), 0) AS mv
      FROM holding_snapshots hs
      JOIN accounts a ON a.id = hs.account_id
      JOIN (
        SELECT account_id, MAX(as_of) AS max_as_of
        FROM holding_snapshots
        WHERE date(as_of) <= @session_ymd
        GROUP BY account_id
      ) _prior_snap ON _prior_snap.account_id = hs.account_id AND _prior_snap.max_as_of = hs.as_of
      JOIN positions p ON p.snapshot_id = hs.id
      WHERE a.id NOT LIKE 'schwab_%'
        AND ${allSyncedAccountsWhereSql("a")}
    `,
    )
    .get({ session_ymd: priorSessionYmd }) as { mv: number } | undefined;

  const current = currentRow?.mv ?? 0;
  const prior = priorRow?.mv ?? current;
  return {
    current: Number.isFinite(current) ? current : 0,
    prior: Number.isFinite(prior) ? prior : current,
  };
}

export async function fetchSchwabLiquidationLive(): Promise<{
  current: number;
  prior: number | null;
} | null> {
  try {
    const accounts = await schwabFetch<SchwabAccountPayload[]>("accounts");
    let current = 0;
    let prior = 0;
    let hasPrior = false;
    for (const a of accounts) {
      const accountId = schwabAccountId(a.securitiesAccount);
      if (!accountId) continue;
      const equity = pickEquityUsd(a.securitiesAccount.currentBalances);
      if (equity == null || !Number.isFinite(equity)) continue;
      current += equity;
      const prev = pickPriorEquityUsd(a.securitiesAccount.currentBalances);
      if (prev != null && Number.isFinite(prev)) {
        prior += prev;
        hasPrior = true;
      }
    }
    if (current <= 0) return null;
    return { current, prior: hasPrior ? prior : null };
  } catch {
    return null;
  }
}

export async function resolvePortfolioAccountTotals(
  sessionYmd: string,
  priorSessionYmd: string,
  db: Database.Database = getDb(),
): Promise<PortfolioAccountTotals | null> {
  const live = await fetchSchwabLiquidationLive();
  const dbSchwab = schwabLiquidationFromDb(db);
  const dbPriorSchwab = schwabPriorLiquidationFromDb(db, priorSessionYmd);
  const external = externalMarketValueFromDb(db, priorSessionYmd);

  const schwabCurrent = live?.current ?? dbSchwab.current;
  if (schwabCurrent <= 0 && external.current <= 0) return null;

  let schwabPrior = live?.prior ?? dbPriorSchwab.prior;
  if (schwabPrior == null || !Number.isFinite(schwabPrior) || schwabPrior <= 0) {
    schwabPrior = dbPriorSchwab.prior > 0 ? dbPriorSchwab.prior : schwabCurrent;
  }

  const netValue = schwabCurrent + external.current;
  const priorNetValue = schwabPrior + external.prior;
  if (priorNetValue <= 0 || netValue <= 0) return null;

  return {
    netValue,
    priorNetValue,
    schwabCurrent,
    schwabPrior,
    externalCurrent: external.current,
    externalPrior: external.prior,
    source: live != null ? "schwab_live" : "schwab_db",
  };
}

/** Prior NY session date before `sessionYmd` (YYYY-MM-DD). */
export function priorNySessionYmd(sessionYmd: string): string {
  const d = new Date(`${sessionYmd}T12:00:00-05:00`);
  d.setDate(d.getDate() - 1);
  while (d.getDay() === 0 || d.getDay() === 6) {
    d.setDate(d.getDate() - 1);
  }
  return isoDateInUsEastern(d.getTime());
}

import type Database from "better-sqlite3";

import { getDb } from "@/lib/db";
import { allSyncedAccountsWhereSql, latestSnapshotPerAccountJoinSql } from "@/lib/holdings/latestSnapshots";
import { POSITION_MARKET_VALUE_SQL } from "@/lib/holdings/positionMarketValue";
import { isAuroraExclusiveAccountId } from "@/lib/auroraExclusive";
import { isoDateInUsEastern } from "@/lib/market/glanceSession";
import { pickEquityUsd, pickSchwabPriorDayEquityUsd } from "@/lib/schwab/accountBalances";
import { schwabFetch } from "@/lib/schwab/client";
import { fetchSchwabSessionNetCashFlow } from "@/lib/terminal/portfolioCashFlows";

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
  /** Schwab net cash flow today (negative = net withdrawal). */
  netCashFlow: number;
  /** Liquidation value adjusted for external cash flows (for day return). */
  adjustedNetValue: number;
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
  const currentRows = db
    .prepare(
      `
      SELECT hs.account_id AS account_id, COALESCE(SUM(${POSITION_MARKET_VALUE_SQL}), 0) AS mv
      FROM holding_snapshots hs
      JOIN accounts a ON a.id = hs.account_id
      ${latestSnapshotPerAccountJoinSql("hs")}
      JOIN positions p ON p.snapshot_id = hs.id
      WHERE a.id NOT LIKE 'schwab_%'
        AND ${allSyncedAccountsWhereSql("a")}
      GROUP BY hs.account_id
    `,
    )
    .all() as Array<{ account_id: string; mv: number }>;

  const priorRows = db
    .prepare(
      `
      SELECT hs.account_id AS account_id, COALESCE(SUM(${POSITION_MARKET_VALUE_SQL}), 0) AS mv
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
      GROUP BY hs.account_id
    `,
    )
    .all({ session_ymd: priorSessionYmd }) as Array<{ account_id: string; mv: number }>;

  const currentByAccount = new Map<string, number>();
  let current = 0;
  for (const row of currentRows) {
    const mv = Number(row.mv);
    if (!Number.isFinite(mv)) continue;
    currentByAccount.set(row.account_id, mv);
    current += mv;
  }

  const priorByAccount = new Map<string, number>();
  for (const row of priorRows) {
    const mv = Number(row.mv);
    if (!Number.isFinite(mv)) continue;
    priorByAccount.set(row.account_id, mv);
  }

  let prior = 0;
  for (const [accountId, currentMv] of currentByAccount) {
    const priorMv = priorByAccount.get(accountId);
    prior += priorMv != null && Number.isFinite(priorMv) && priorMv > 0 ? priorMv : currentMv;
  }

  return { current: Number.isFinite(current) ? current : 0, prior: Number.isFinite(prior) ? prior : current };
}

export async function fetchSchwabLiquidationLive(): Promise<{
  byAccount: Map<string, { current: number; prior: number | null }>;
  current: number;
  prior: number | null;
} | null> {
  try {
    const accounts = await schwabFetch<SchwabAccountPayload[]>("accounts");
    const byAccount = new Map<string, { current: number; prior: number | null }>();
    let current = 0;
    let prior = 0;
    let accountsWithPrior = 0;
    for (const a of accounts) {
      const accountId = schwabAccountId(a.securitiesAccount);
      if (!accountId) continue;
      const equity = pickEquityUsd(a.securitiesAccount.currentBalances);
      if (equity == null || !Number.isFinite(equity) || equity <= 0) continue;
      const prev = pickSchwabPriorDayEquityUsd(a.securitiesAccount.currentBalances);
      byAccount.set(accountId, { current: equity, prior: prev });
      current += equity;
      if (prev != null && Number.isFinite(prev) && prev > 0) {
        prior += prev;
        accountsWithPrior += 1;
      }
    }
    if (current <= 0 || byAccount.size === 0) return null;
    return {
      byAccount,
      current,
      prior: accountsWithPrior === byAccount.size ? prior : null,
    };
  } catch {
    return null;
  }
}

/** Latest stored Schwab prior-day equity per account (from the most recent sync). */
export function schwabPriorEquityFromLatestSync(db: Database.Database): {
  prior: number;
  byAccount: Map<string, number>;
} {
  const rows = db
    .prepare(
      `
      SELECT av.account_id AS account_id, av.prior_equity_value AS prior_equity_value
      FROM account_value_points av
      JOIN accounts a ON a.id = av.account_id
      JOIN (
        SELECT account_id, MAX(as_of) AS max_as_of
        FROM account_value_points
        GROUP BY account_id
      ) latest ON latest.account_id = av.account_id AND latest.max_as_of = av.as_of
      WHERE a.id LIKE 'schwab_%'
        AND ${allSyncedAccountsWhereSql("a")}
        AND av.prior_equity_value IS NOT NULL
        AND av.prior_equity_value > 0
    `,
    )
    .all() as Array<{ account_id: string; prior_equity_value: number }>;

  const byAccount = new Map<string, number>();
  let prior = 0;
  for (const row of rows) {
    const v = row.prior_equity_value;
    if (!Number.isFinite(v)) continue;
    byAccount.set(row.account_id, v);
    prior += v;
  }
  return { prior, byAccount };
}

function resolveSchwabAccountTotals(
  live: Awaited<ReturnType<typeof fetchSchwabLiquidationLive>>,
  dbCurrent: ReturnType<typeof schwabLiquidationFromDb>,
  dbPrior: ReturnType<typeof schwabPriorLiquidationFromDb>,
  dbPriorEquity: ReturnType<typeof schwabPriorEquityFromLatestSync>,
): { current: number; prior: number } {
  const accountIds = new Set<string>([
    ...dbCurrent.byAccount.keys(),
    ...dbPrior.byAccount.keys(),
    ...dbPriorEquity.byAccount.keys(),
    ...(live?.byAccount.keys() ?? []),
  ]);
  let current = 0;
  let prior = 0;
  for (const accountId of accountIds) {
    const liveEntry = live?.byAccount.get(accountId);
    const cur = liveEntry?.current ?? dbCurrent.byAccount.get(accountId);
    if (cur == null || !Number.isFinite(cur) || cur <= 0) continue;
    // Prefer synced prior-session liquidation over live previousDayEquity when both exist —
    // the API field can disagree with liquidation and inflate day %.
    let pri =
      dbPrior.byAccount.get(accountId) ??
      liveEntry?.prior ??
      dbPriorEquity.byAccount.get(accountId) ??
      null;
    if (pri == null || !Number.isFinite(pri) || pri <= 0) {
      pri = cur;
    }
    current += cur;
    prior += pri;
  }
  return { current, prior };
}

/** Intraday Schwab liquidation totals for one NY session day (for portfolio sparklines). */
export function schwabIntradayTotalsFromDb(
  db: Database.Database,
  sessionYmd: string,
): Array<{ asOf: string; tsMs: number; total: number }> {
  const rows = db
    .prepare(
      `
      SELECT av.as_of AS as_of, SUM(av.equity_value) AS total
      FROM account_value_points av
      JOIN accounts a ON a.id = av.account_id
      WHERE a.id LIKE 'schwab_%' AND ${allSyncedAccountsWhereSql("a")}
      GROUP BY av.as_of
      ORDER BY av.as_of ASC
    `,
    )
    .all() as Array<{ as_of: string; total: number }>;

  return rows
    .filter(
      (row) =>
        isoDateInUsEastern(Date.parse(row.as_of)) === sessionYmd &&
        Number.isFinite(row.total) &&
        row.total > 0,
    )
    .map((row) => ({
      asOf: row.as_of,
      tsMs: Date.parse(row.as_of),
      total: row.total,
    }))
    .filter((row) => Number.isFinite(row.tsMs));
}

export async function resolvePortfolioAccountTotals(
  sessionYmd: string,
  priorSessionYmd: string,
  db: Database.Database = getDb(),
): Promise<PortfolioAccountTotals | null> {
  const live = await fetchSchwabLiquidationLive();
  const dbSchwab = schwabLiquidationFromDb(db);
  const dbPriorSchwab = schwabPriorLiquidationFromDb(db, priorSessionYmd);
  const dbPriorEquity = schwabPriorEquityFromLatestSync(db);
  const external = externalMarketValueFromDb(db, priorSessionYmd);
  const schwabTotals = resolveSchwabAccountTotals(live, dbSchwab, dbPriorSchwab, dbPriorEquity);

  const schwabCurrent = schwabTotals.current;
  if (schwabCurrent <= 0 && external.current <= 0) return null;

  const schwabPrior = schwabTotals.prior > 0 ? schwabTotals.prior : schwabCurrent;

  const netValue = schwabCurrent + external.current;
  const priorNetValue = schwabPrior + external.prior;
  if (priorNetValue <= 0 || netValue <= 0) return null;

  let netCashFlow = 0;
  if (live != null) {
    try {
      netCashFlow = await fetchSchwabSessionNetCashFlow(sessionYmd, db);
    } catch {
      netCashFlow = 0;
    }
  }
  const adjustedNetValue = netValue - netCashFlow;

  return {
    netValue,
    priorNetValue,
    netCashFlow,
    adjustedNetValue,
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

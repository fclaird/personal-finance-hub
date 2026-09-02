import type Database from "better-sqlite3";

import { getDb } from "@/lib/db";
import { allSyncedAccountsWhereSql, latestSnapshotPerAccountJoinSql } from "@/lib/holdings/latestSnapshots";
import { POSITION_MARKET_VALUE_SQL } from "@/lib/holdings/positionMarketValue";
import type { FlavorId } from "@/lib/flavor";
import { isAccountInFlavor } from "@/lib/flavors/accounts";
import { isoDateInUsEastern } from "@/lib/market/glanceSession";
import { buildLiveEquityMarkMap } from "@/lib/market/liveEquityMarks";
import {
  markToMarketFund,
  needsPlanFundPricing,
  parseFundStatementBasis,
} from "@/lib/market/planFundPricing";
import { fetchYahooLatestPrices } from "@/lib/market/yahooLatestPrice";
import { isManualAccountId, parseManualPositionMetadata } from "@/lib/manual/manualAccounts";
import { schwabAccountValuesFresh } from "@/lib/schwab/accountValuePoints";
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

function schwabAccountId(sa: SchwabAccountPayload["securitiesAccount"], flavor: FlavorId): string | null {
  const acctIdPart =
    (sa.accountId != null && String(sa.accountId).trim() !== "" ? String(sa.accountId) : null) ??
    (sa.accountNumber != null && String(sa.accountNumber).trim() !== "" ? String(sa.accountNumber) : null);
  if (!acctIdPart) return null;
  const accountId = `schwab_${acctIdPart}`;
  if (!isAccountInFlavor(flavor, accountId)) return null;
  return accountId;
}

/** Sum latest Schwab liquidation values stored from sync. */
export function schwabLiquidationFromDb(db: Database.Database, flavor: FlavorId = "main"): { current: number; byAccount: Map<string, number> } {
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
      WHERE a.id LIKE 'schwab_%' AND ${allSyncedAccountsWhereSql(flavor, "a")}
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
  flavor: FlavorId = "main",
): { prior: number; byAccount: Map<string, number> } {
  const rows = db
    .prepare(
      `
      SELECT av.account_id AS account_id, av.as_of AS as_of, av.equity_value AS equity_value
      FROM account_value_points av
      JOIN accounts a ON a.id = av.account_id
      WHERE a.id LIKE 'schwab_%' AND ${allSyncedAccountsWhereSql(flavor, "a")}
      ORDER BY av.as_of ASC
    `,
    )
    .all() as Array<{ account_id: string; as_of: string; equity_value: number }>;

  const latestPerAccount = new Map<string, { as_of: string; equity_value: number }>();
  for (const row of rows) {
    if (isoDateInUsEastern(Date.parse(row.as_of)) > sessionYmd) continue;
    const prev = latestPerAccount.get(row.account_id);
    if (!prev || row.as_of > prev.as_of) {
      latestPerAccount.set(row.account_id, { as_of: row.as_of, equity_value: row.equity_value });
    }
  }

  const byAccount = new Map<string, number>();
  let prior = 0;
  for (const [accountId, row] of latestPerAccount) {
    const v = row.equity_value;
    if (!Number.isFinite(v)) continue;
    byAccount.set(accountId, v);
    prior += v;
  }
  return { prior, byAccount };
}

/** Manual, Plaid, and other non-Schwab accounts from latest holding snapshots. */
export function externalMarketValueFromDb(db: Database.Database, priorSessionYmd: string, flavor: FlavorId = "main"): {
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
        AND ${allSyncedAccountsWhereSql(flavor, "a")}
    `,
    )
    .get() as { mv: number } | undefined;

  const priorSnapshots = db
    .prepare(
      `
      SELECT hs.account_id AS account_id, hs.id AS snapshot_id, hs.as_of AS as_of
      FROM holding_snapshots hs
      JOIN accounts a ON a.id = hs.account_id
      WHERE a.id NOT LIKE 'schwab_%'
        AND ${allSyncedAccountsWhereSql(flavor, "a")}
    `,
    )
    .all() as Array<{ account_id: string; snapshot_id: string; as_of: string }>;

  const latestPriorSnapPerAccount = new Map<string, string>();
  for (const snap of priorSnapshots) {
    if (isoDateInUsEastern(Date.parse(snap.as_of)) > priorSessionYmd) continue;
    const prevId = latestPriorSnapPerAccount.get(snap.account_id);
    const prevAsOf = prevId
      ? priorSnapshots.find((row) => row.snapshot_id === prevId)?.as_of
      : null;
    if (!prevId || !prevAsOf || snap.as_of > prevAsOf) {
      latestPriorSnapPerAccount.set(snap.account_id, snap.snapshot_id);
    }
  }

  const priorSnapIds = [...latestPriorSnapPerAccount.values()];
  const priorRow =
    priorSnapIds.length === 0
      ? undefined
      : (db
          .prepare(
            `
      SELECT COALESCE(SUM(${POSITION_MARKET_VALUE_SQL}), 0) AS mv
      FROM positions p
      WHERE p.snapshot_id IN (SELECT value FROM json_each(@snaps))
    `,
          )
          .get({ snaps: JSON.stringify(priorSnapIds) }) as { mv: number } | undefined);

  const current = currentRow?.mv ?? 0;
  const priorRaw = priorRow?.mv;
  // SUM() is 0 when no prior snapshot exists — must not treat as "$0 external yesterday".
  const prior =
    priorRaw != null && Number.isFinite(priorRaw) && priorRaw > 0 ? priorRaw : current;
  return {
    current: Number.isFinite(current) ? current : 0,
    prior: Number.isFinite(prior) ? prior : current,
  };
}

export type ExternalPositionRow = {
  accountId: string;
  accountBucket: string | null;
  securityType: string;
  symbol: string | null;
  metadataJson: string | null;
  quantity: number | null;
  price: number | null;
  marketValue: number | null;
};

function collectExternalSnapshotIds(
  db: Database.Database,
  priorSessionYmd: string,
  flavor: FlavorId,
): { currentSnapIds: string[]; priorSnapIds: string[] } {
  const currentRows = db
    .prepare(
      `
      SELECT hs.id AS snapshot_id
      FROM holding_snapshots hs
      JOIN accounts a ON a.id = hs.account_id
      ${latestSnapshotPerAccountJoinSql("hs")}
      WHERE a.id NOT LIKE 'schwab_%'
        AND ${allSyncedAccountsWhereSql(flavor, "a")}
    `,
    )
    .all() as Array<{ snapshot_id: string }>;

  const priorSnapshots = db
    .prepare(
      `
      SELECT hs.account_id AS account_id, hs.id AS snapshot_id, hs.as_of AS as_of
      FROM holding_snapshots hs
      JOIN accounts a ON a.id = hs.account_id
      WHERE a.id NOT LIKE 'schwab_%'
        AND ${allSyncedAccountsWhereSql(flavor, "a")}
    `,
    )
    .all() as Array<{ account_id: string; snapshot_id: string; as_of: string }>;

  const latestPriorSnapPerAccount = new Map<string, string>();
  for (const snap of priorSnapshots) {
    if (isoDateInUsEastern(Date.parse(snap.as_of)) > priorSessionYmd) continue;
    const prevId = latestPriorSnapPerAccount.get(snap.account_id);
    const prevAsOf = prevId
      ? priorSnapshots.find((row) => row.snapshot_id === prevId)?.as_of
      : null;
    if (!prevId || !prevAsOf || snap.as_of > prevAsOf) {
      latestPriorSnapPerAccount.set(snap.account_id, snap.snapshot_id);
    }
  }

  return {
    currentSnapIds: currentRows.map((row) => row.snapshot_id),
    priorSnapIds: [...latestPriorSnapPerAccount.values()],
  };
}

function listExternalPositions(db: Database.Database, snapshotIds: string[]): ExternalPositionRow[] {
  if (snapshotIds.length === 0) return [];
  return db
    .prepare(
      `
      SELECT
        a.id AS accountId,
        a.account_bucket AS accountBucket,
        s.security_type AS securityType,
        s.symbol AS symbol,
        p.metadata_json AS metadataJson,
        p.quantity AS quantity,
        p.price AS price,
        p.market_value AS marketValue
      FROM positions p
      JOIN holding_snapshots hs ON hs.id = p.snapshot_id
      JOIN accounts a ON a.id = hs.account_id
      JOIN securities s ON s.id = p.security_id
      WHERE p.snapshot_id IN (SELECT value FROM json_each(@snaps))
    `,
    )
    .all({ snaps: JSON.stringify(snapshotIds) }) as ExternalPositionRow[];
}

export function effectiveExternalPositionMv(
  row: ExternalPositionRow,
  navMap: Map<string, number>,
): number {
  const isManual =
    isManualAccountId(row.accountId) || parseManualPositionMetadata(row.metadataJson) != null;
  const manualMeta = parseManualPositionMetadata(row.metadataJson);
  const planFund = needsPlanFundPricing(isManual, row.securityType, row.accountBucket);
  const fundBasis = parseFundStatementBasis(manualMeta);
  if (planFund && fundBasis) {
    const sym = (row.symbol ?? "").trim().toUpperCase();
    const nav = sym ? navMap.get(sym) : undefined;
    if (nav != null && Number.isFinite(nav) && nav > 0) {
      return markToMarketFund(fundBasis, nav);
    }
  }
  const mv = row.marketValue;
  if (mv != null && Number.isFinite(mv)) return mv;
  return (row.price ?? 0) * (row.quantity ?? 0);
}

export function sumExternalPositionsWithNav(
  rows: ExternalPositionRow[],
  navMap: Map<string, number>,
): number {
  let sum = 0;
  for (const row of rows) {
    sum += effectiveExternalPositionMv(row, navMap);
  }
  return sum;
}

function loadFundNavOnOrBefore(
  db: Database.Database,
  symbols: Iterable<string>,
  ymd: string,
): Map<string, number> {
  const keys = [...new Set([...symbols].map((s) => s.trim().toUpperCase()).filter(Boolean))];
  if (keys.length === 0) return new Map();

  const stmt = db.prepare(
    `
    SELECT close
    FROM price_points
    WHERE provider IN ('yahoo', 'schwab') AND symbol = ? AND date <= ?
    ORDER BY date DESC
    LIMIT 1
  `,
  );
  const out = new Map<string, number>();
  for (const sym of keys) {
    const row = stmt.get(sym, ymd) as { close: number } | undefined;
    if (row?.close != null && Number.isFinite(row.close) && row.close > 0) {
      out.set(sym, row.close);
    }
  }
  return out;
}

function collectPlanFundSymbols(rows: ExternalPositionRow[]): Set<string> {
  const symbols = new Set<string>();
  for (const row of rows) {
    const isManual =
      isManualAccountId(row.accountId) || parseManualPositionMetadata(row.metadataJson) != null;
    if (!needsPlanFundPricing(isManual, row.securityType, row.accountBucket)) continue;
    const sym = (row.symbol ?? "").trim().toUpperCase();
    if (sym) symbols.add(sym);
  }
  return symbols;
}

/** External account totals with 529/plan fund mark-to-market (matches `/api/positions` in-memory MV). */
export async function resolveExternalMarketValue(
  db: Database.Database,
  priorSessionYmd: string,
  flavor: FlavorId = "main",
): Promise<{ current: number; prior: number }> {
  const raw = externalMarketValueFromDb(db, priorSessionYmd, flavor);
  const { currentSnapIds, priorSnapIds } = collectExternalSnapshotIds(db, priorSessionYmd, flavor);
  const currentRows = listExternalPositions(db, currentSnapIds);
  const priorRows = listExternalPositions(db, priorSnapIds);
  const planFundSymbols = collectPlanFundSymbols([...currentRows, ...priorRows]);
  if (planFundSymbols.size === 0) return raw;

  const schwabMarks = await buildLiveEquityMarkMap(planFundSymbols);
  const yahooMarks = await fetchYahooLatestPrices(planFundSymbols);
  const currentNavMap = new Map<string, number>();
  for (const sym of planFundSymbols) {
    const px = schwabMarks.get(sym) ?? yahooMarks.get(sym);
    if (px != null && Number.isFinite(px) && px > 0) currentNavMap.set(sym, px);
  }

  const priorNavMap = loadFundNavOnOrBefore(db, planFundSymbols, priorSessionYmd);
  for (const sym of planFundSymbols) {
    if (!priorNavMap.has(sym) && currentNavMap.has(sym)) {
      priorNavMap.set(sym, currentNavMap.get(sym)!);
    }
  }

  const current = sumExternalPositionsWithNav(currentRows, currentNavMap);
  const priorRaw = priorSnapIds.length === 0 ? 0 : sumExternalPositionsWithNav(priorRows, priorNavMap);
  const prior = priorRaw > 0 ? priorRaw : current;

  return {
    current: Number.isFinite(current) ? current : raw.current,
    prior: Number.isFinite(prior) ? prior : raw.prior,
  };
}

export async function fetchSchwabLiquidationLive(flavor: FlavorId = "main"): Promise<{
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
      const accountId = schwabAccountId(a.securitiesAccount, flavor);
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
export function schwabPriorEquityFromLatestSync(db: Database.Database, flavor: FlavorId = "main"): {
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
        AND ${allSyncedAccountsWhereSql(flavor, "a")}
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
  flavor: FlavorId = "main",
): Array<{ asOf: string; tsMs: number; total: number }> {
  const rows = db
    .prepare(
      `
      SELECT av.as_of AS as_of, SUM(av.equity_value) AS total
      FROM account_value_points av
      JOIN accounts a ON a.id = av.account_id
      WHERE a.id LIKE 'schwab_%' AND ${allSyncedAccountsWhereSql(flavor, "a")}
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
  flavor: FlavorId = "main",
): Promise<PortfolioAccountTotals | null> {
  const live =
    schwabAccountValuesFresh(db) ? null : await fetchSchwabLiquidationLive(flavor);
  const dbSchwab = schwabLiquidationFromDb(db, flavor);
  const dbPriorSchwab = schwabPriorLiquidationFromDb(db, priorSessionYmd, flavor);
  const dbPriorEquity = schwabPriorEquityFromLatestSync(db, flavor);
  const external = await resolveExternalMarketValue(db, priorSessionYmd, flavor);
  const schwabTotals = resolveSchwabAccountTotals(live, dbSchwab, dbPriorSchwab, dbPriorEquity);

  const schwabCurrent = schwabTotals.current;
  if (schwabCurrent <= 0 && external.current <= 0) return null;

  const schwabPrior = schwabTotals.prior > 0 ? schwabTotals.prior : schwabCurrent;

  const netValue = schwabCurrent + external.current;
  const priorNetValue = schwabPrior + external.prior;
  if (priorNetValue <= 0 || netValue <= 0) return null;

  let netCashFlow = 0;
  try {
    netCashFlow = await fetchSchwabSessionNetCashFlow(sessionYmd, db, flavor);
  } catch {
    netCashFlow = 0;
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

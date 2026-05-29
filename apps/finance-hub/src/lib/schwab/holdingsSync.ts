import type Database from "better-sqlite3";

import { AURORA_EXCLUSIVE_ACCOUNT_IDS, isAuroraExclusiveAccountId } from "@/lib/auroraExclusive";
import { getDb } from "@/lib/db";
import { newId } from "@/lib/id";
import { logError } from "@/lib/log";
import type { DataMode } from "@/lib/dataMode";
import { ensureBenchmarkHistory } from "@/lib/market/benchmarks";
import { ensureOptionGreeksOnLatestSnapshots } from "@/lib/schwab/ensureOptionGreeks";
import { pickEquityUsd, pickSchwabPriorDayEquityUsd } from "@/lib/schwab/accountBalances";
import { lastCompletedNyWeekday } from "@/lib/analytics/allocationNyDate";
import { recordAllocationDailyCloseModes } from "@/lib/analytics/recordAllocationDailyClose";
import { upsertWeekEndingPortfolioSnapshots } from "@/lib/portfolio/snapshots";
import { schwabFetch } from "@/lib/schwab/client";

type SchwabAccountNumber = { accountNumber?: string; hashValue?: string };

type SchwabAccount = {
  securitiesAccount: {
    accountId: string;
    type?: string;
    accountNumber?: string;
    currentBalances?: Record<string, unknown>;
    positions?: Array<{
      instrument: {
        assetType?: string;
        symbol?: string;
        description?: string;
        underlyingSymbol?: string;
      };
      longQuantity?: number;
      shortQuantity?: number;
      averagePrice?: number;
      marketValue?: number;
    }>;
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

export type SchwabHoldingsSyncResult = {
  ok: boolean;
  accounts: number;
  holdingsAsOf: string | null;
  error?: string;
};

export async function runSchwabHoldingsSync(
  opts?: { db?: Database.Database; dataMode?: DataMode },
): Promise<SchwabHoldingsSyncResult> {
  const db = opts?.db ?? getDb();
  const nowIso = new Date().toISOString();

  try {
    db.prepare(`DELETE FROM accounts WHERE id = 'schwab_undefined'`).run();
    db.prepare(`DELETE FROM accounts WHERE id LIKE 'demo_%'`).run();
    for (const auroraId of AURORA_EXCLUSIVE_ACCOUNT_IDS) {
      db.prepare(`DELETE FROM accounts WHERE id = ?`).run(auroraId);
    }

    let accounts: Array<SchwabAccount & { __accountNumber: string | null }> = [];
    try {
      const all = await schwabFetch<SchwabAccount[]>("accounts?fields=positions");
      accounts = all.map((a) => ({ ...a, __accountNumber: a.securitiesAccount.accountNumber ?? null }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const acctNums = await schwabFetch<SchwabAccountNumber[]>("accounts/accountNumbers");
      const refs = acctNums
        .map((a) => ({ accountNumber: a.accountNumber ?? null, hash: a.hashValue ?? null }))
        .filter((a) => a.accountNumber || a.hash);
      accounts = await Promise.all(
        refs.map(async (a) => {
          try {
            if (a.hash) {
              const acc = await schwabFetch<SchwabAccount>(
                `accounts/${encodeURIComponent(a.hash)}?fields=positions`,
              );
              return { ...acc, __accountNumber: a.accountNumber } as SchwabAccount & { __accountNumber: string | null };
            }
          } catch (e2) {
            const m2 = e2 instanceof Error ? e2.message : String(e2);
            if (!m2.toLowerCase().includes("invalid account number")) throw e2;
          }
          if (!a.accountNumber) throw new Error(`Schwab account lookup failed. Prior error: ${msg.slice(0, 200)}`);
          const acc = await schwabFetch<SchwabAccount>(
            `accounts/${encodeURIComponent(a.accountNumber)}?fields=positions`,
          );
          return { ...acc, __accountNumber: a.accountNumber } as SchwabAccount & { __accountNumber: string | null };
        }),
      );
    }

    const upsertConn = db.prepare(`
    INSERT INTO institution_connections (id, type, display_name, status, last_sync_at, updated_at)
    VALUES (@id, 'schwab', 'Schwab', 'active', @now, @now)
    ON CONFLICT(id) DO UPDATE SET last_sync_at = excluded.last_sync_at, updated_at = excluded.updated_at, status = 'active'
  `);
    const connId = "schwab_default";
    upsertConn.run({ id: connId, now: nowIso });

    const upsertAccount = db.prepare(`
    INSERT INTO accounts (id, connection_id, name, type, currency, updated_at)
    VALUES (@id, @connection_id, @name, @type, 'USD', @now)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, type = excluded.type, updated_at = excluded.updated_at
  `);

    const insertSecurity = db.prepare(`
    INSERT INTO securities (id, symbol, name, security_type, underlying_security_id, updated_at)
    VALUES (@id, @symbol, @name, @security_type, @underlying_security_id, @now)
    ON CONFLICT(id) DO UPDATE SET symbol = excluded.symbol, name = excluded.name, updated_at = excluded.updated_at
  `);

    const insertSnapshot = db.prepare(`
    INSERT INTO holding_snapshots (id, account_id, as_of)
    VALUES (@id, @account_id, @as_of)
  `);

    const insertPosition = db.prepare(`
    INSERT INTO positions (id, snapshot_id, security_id, quantity, price, market_value, metadata_json)
    VALUES (@id, @snapshot_id, @security_id, @quantity, @price, @market_value, @metadata_json)
  `);

    const upsertAccountValuePoint = db.prepare(`
    INSERT INTO account_value_points (account_id, as_of, equity_value, cash_value, prior_equity_value, source)
    VALUES (@account_id, @as_of, @equity_value, @cash_value, @prior_equity_value, 'schwab_balances')
    ON CONFLICT(account_id, as_of) DO UPDATE SET
      equity_value = excluded.equity_value,
      cash_value = excluded.cash_value,
      prior_equity_value = excluded.prior_equity_value
  `);

    const tx = db.transaction(() => {
      insertSecurity.run({
        id: "sec_CASH",
        symbol: "CASH",
        name: "Cash",
        security_type: "cash",
        underlying_security_id: null,
        now: nowIso,
      });

      for (const a of accounts) {
        const sa = a.securitiesAccount;
        const acctIdPart =
          (sa.accountId != null && String(sa.accountId).trim() !== "" ? String(sa.accountId) : null) ??
          (a.__accountNumber != null && a.__accountNumber.trim() !== "" ? a.__accountNumber : null) ??
          (sa.accountNumber != null && String(sa.accountNumber).trim() !== "" ? String(sa.accountNumber) : null) ??
          newId("schwabacct");

        const accountId = `schwab_${acctIdPart}`;
        if (isAuroraExclusiveAccountId(accountId)) continue;
        upsertAccount.run({
          id: accountId,
          connection_id: connId,
          name: a.__accountNumber
            ? `Schwab ${a.__accountNumber}`
            : sa.accountNumber
              ? `Schwab ${sa.accountNumber}`
              : `Schwab ${sa.accountId}`,
          type: sa.type ?? "brokerage",
          now: nowIso,
        });

        const snapshotId = newId("snap");
        insertSnapshot.run({ id: snapshotId, account_id: accountId, as_of: nowIso });

        const cashUsd = pickCashUsd(sa.currentBalances);
        let computedPositionsMv = 0;
        let hasAnyPosMv = false;
        if (cashUsd != null && Number.isFinite(cashUsd) && cashUsd !== 0) {
          insertPosition.run({
            id: newId("pos"),
            snapshot_id: snapshotId,
            security_id: "sec_CASH",
            quantity: cashUsd,
            price: 1,
            market_value: cashUsd,
            metadata_json: JSON.stringify({
              provider: "schwab",
              kind: "cash_balance",
              currentBalances: sa.currentBalances,
            }),
          });
        }

        for (const p of sa.positions ?? []) {
          const symbol = p.instrument.symbol ?? p.instrument.underlyingSymbol ?? "UNKNOWN";
          const securityId = `sec_${symbol}`;
          const assetType = (p.instrument.assetType ?? "OTHER").toUpperCase();
          const securityType =
            assetType === "OPTION"
              ? "option"
              : assetType === "EQUITY"
                ? "equity"
                : assetType.includes("MUTUAL_FUND") ||
                    assetType === "ETF" ||
                    assetType.includes("EXCHANGE_TRADED") ||
                    assetType.includes("COLLECTIVE_INVESTMENT") ||
                    assetType.includes("FUND")
                  ? "fund"
                  : "other";

          let underlyingSecurityId: string | null = null;
          if (securityType === "option" && p.instrument.underlyingSymbol) {
            underlyingSecurityId = `sec_${p.instrument.underlyingSymbol}`;
            insertSecurity.run({
              id: underlyingSecurityId,
              symbol: p.instrument.underlyingSymbol,
              name: p.instrument.underlyingSymbol,
              security_type: "equity",
              underlying_security_id: null,
              now: nowIso,
            });
          }

          insertSecurity.run({
            id: securityId,
            symbol,
            name: p.instrument.description ?? symbol,
            security_type: securityType,
            underlying_security_id: underlyingSecurityId,
            now: nowIso,
          });

          const qty = (p.longQuantity ?? 0) - (p.shortQuantity ?? 0);
          if (p.marketValue != null && Number.isFinite(p.marketValue)) {
            computedPositionsMv += p.marketValue;
            hasAnyPosMv = true;
          }
          insertPosition.run({
            id: newId("pos"),
            snapshot_id: snapshotId,
            security_id: securityId,
            quantity: qty,
            price: p.averagePrice ?? null,
            market_value: p.marketValue ?? null,
            metadata_json: JSON.stringify(p),
          });
        }

        const equityFromBalances = pickEquityUsd(sa.currentBalances);
        const priorEquity = pickSchwabPriorDayEquityUsd(sa.currentBalances);
        const equityValue =
          equityFromBalances ?? (cashUsd ?? 0) + (hasAnyPosMv ? computedPositionsMv : 0);
        if (Number.isFinite(equityValue)) {
          upsertAccountValuePoint.run({
            account_id: accountId,
            as_of: nowIso,
            equity_value: equityValue,
            cash_value: cashUsd,
            prior_equity_value: priorEquity,
          });
        }
      }
    });

    tx();

    try {
      ensureOptionGreeksOnLatestSnapshots(db);
    } catch (e) {
      logError("option_greeks_carry_forward_after_holdings", e);
    }

    const mode = opts?.dataMode ?? "schwab";
    try {
      await ensureBenchmarkHistory("SPY");
      await ensureBenchmarkHistory("QQQ");
      await ensureBenchmarkHistory("IWM");
      upsertWeekEndingPortfolioSnapshots(db, mode, "weekly_job");
      recordAllocationDailyCloseModes(db, lastCompletedNyWeekday(), [mode]);
    } catch (e) {
      logError("portfolio_snapshot_after_schwab_sync", e);
    }

    return { ok: true, accounts: accounts.length, holdingsAsOf: nowIso };
  } catch (e) {
    logError("schwab_holdings_sync_failed", e);
    return {
      ok: false,
      accounts: 0,
      holdingsAsOf: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

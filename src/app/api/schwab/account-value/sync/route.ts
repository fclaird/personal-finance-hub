import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { logError } from "@/lib/log";
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

function pickEquityUsd(cb: Record<string, unknown> | undefined): number | null {
  if (!cb) return null;
  const keys = [
    "liquidationValue",
    "netLiquidation",
    "equity",
    "equityValue",
    "accountValue",
    "totalAccountValue",
    "totalValue",
  ];
  for (const k of keys) {
    const n = asNumber(cb[k]);
    if (n != null) return n;
  }
  return null;
}

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const range = url.searchParams.get("range") ?? "now";

    // Schwab does not appear to provide true historical equity curves; this route records
    // the current balances as a point-in-time value series ("best available").
    const accounts = await schwabFetch<SchwabAccount[]>("accounts");

    const db = getDb();
    const nowIso = new Date().toISOString();

    const upsert = db.prepare(`
      INSERT INTO account_value_points (account_id, as_of, equity_value, cash_value, source)
      VALUES (@account_id, @as_of, @equity_value, @cash_value, 'schwab_balances')
      ON CONFLICT(account_id, as_of) DO UPDATE SET
        equity_value = excluded.equity_value,
        cash_value = excluded.cash_value
    `);

    let wrote = 0;
    const tx = db.transaction(() => {
      for (const a of accounts) {
        const sa = a.securitiesAccount;
        const acctIdPart =
          (sa.accountId != null && String(sa.accountId).trim() !== "" ? String(sa.accountId) : null) ??
          (sa.accountNumber != null && String(sa.accountNumber).trim() !== "" ? String(sa.accountNumber) : null);
        if (!acctIdPart) continue;
        const accountId = `schwab_${acctIdPart}`;
        const cash = pickCashUsd(sa.currentBalances);
        const equity = pickEquityUsd(sa.currentBalances);
        if (equity == null || !Number.isFinite(equity)) continue;
        upsert.run({ account_id: accountId, as_of: nowIso, equity_value: equity, cash_value: cash });
        wrote += 1;
      }
    });
    tx();

    return NextResponse.json({
      ok: true,
      range,
      wrote,
      note:
        "Schwab does not expose true historical account equity; this records point-in-time balances so history accumulates going forward.",
    });
  } catch (e) {
    logError("schwab_account_value_sync_failed", e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}


import { NextResponse } from "next/server";

import { computePeriodReport } from "@/lib/analytics/periodReport";
import { parsePeriodKind } from "@/lib/analytics/periodWindows";
import { logError } from "@/lib/log";
import { SCHWAB_REFRESH_TRANSACTION_LOOKBACK_DAYS } from "@/lib/schwab/config";
import { syncSchwabBrokerTransactions } from "@/lib/schwab/syncBrokerTransactions";
import { resolveViewScope } from "@/lib/viewScope";

let lastReportsTransactionSyncAt = 0;
const REPORTS_TX_SYNC_MIN_INTERVAL_MS = 120_000;

async function ensureRecentTransactionSync(): Promise<void> {
  const now = Date.now();
  if (now - lastReportsTransactionSyncAt < REPORTS_TX_SYNC_MIN_INTERVAL_MS) return;
  lastReportsTransactionSyncAt = now;
  try {
    await syncSchwabBrokerTransactions({ lookbackDays: SCHWAB_REFRESH_TRANSACTION_LOOKBACK_DAYS });
  } catch (e) {
    logError("reports_transaction_sync_failed", e);
  }
}

export async function GET(req: Request) {
  try {
    await ensureRecentTransactionSync();
    const url = new URL(req.url);
    const periodRaw = url.searchParams.get("period");
    const period = parsePeriodKind(periodRaw) ?? (periodRaw?.trim() ? null : "daily");
    if (!period) {
      return NextResponse.json({ ok: false, error: "Invalid period" }, { status: 400 });
    }

    const { flavor, dataMode: mode } = await resolveViewScope();
    const report = await computePeriodReport({ period, flavor });

    return NextResponse.json({
      ok: true,
      mode,
      flavor,
      period: report.period,
      window: report.window,
      metrics: report.metrics,
      trades: report.trades,
      tradeLedgerComplete: report.tradeLedgerComplete,
      footnotes: report.footnotes,
    });
  } catch (e) {
    logError("reports_get_failed", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

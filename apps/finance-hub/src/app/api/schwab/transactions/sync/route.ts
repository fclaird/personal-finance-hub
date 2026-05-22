import { NextResponse } from "next/server";

import { logError } from "@/lib/log";
import {
  DEFAULT_TRANSACTION_LOOKBACK_DAYS,
  MAX_TRANSACTION_LOOKBACK_DAYS,
} from "@/lib/schwab/config";
import { syncSchwabBrokerTransactions } from "@/lib/schwab/syncBrokerTransactions";

function clampLookbackDays(n: number): number {
  return Math.min(MAX_TRANSACTION_LOOKBACK_DAYS, Math.max(1, Math.floor(n)));
}

export async function POST(req: Request) {
  try {
    let lookbackDays = DEFAULT_TRANSACTION_LOOKBACK_DAYS;
    const ct = req.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      try {
        const body = (await req.json()) as { lookbackDays?: unknown };
        if (typeof body.lookbackDays === "number" && Number.isFinite(body.lookbackDays)) {
          lookbackDays = clampLookbackDays(body.lookbackDays);
        }
      } catch {
        // empty or invalid body → default lookback
      }
    }

    const result = await syncSchwabBrokerTransactions({ lookbackDays });
    return NextResponse.json(result);
  } catch (e) {
    logError("schwab_transactions_sync_failed", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

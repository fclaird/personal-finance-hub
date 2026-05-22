import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { logError } from "@/lib/log";
import { DATA_MODE_COOKIE, parseDataMode } from "@/lib/dataMode";
import { runSchwabHoldingsSync } from "@/lib/schwab/holdingsSync";

export async function POST() {
  try {
    const jar = await cookies();
    const mode = parseDataMode(jar.get(DATA_MODE_COOKIE)?.value);
    const result = await runSchwabHoldingsSync({ dataMode: mode });
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error ?? "Sync failed" }, { status: 500 });
    }
    return NextResponse.json({ ok: true, accounts: result.accounts });
  } catch (e) {
    logError("schwab_sync_failed", e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

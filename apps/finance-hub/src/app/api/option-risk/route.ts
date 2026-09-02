import { NextResponse } from "next/server";

import {
  DEFAULT_OPTION_RISK_CONFIGS,
  loadOptionRiskSummary,
  type OptionRiskConfigs,
} from "@/lib/alerts/optionRisk";
import { getDb } from "@/lib/db";
import { latestSnapshotScopeForMode } from "@/lib/holdings/latestSnapshots";
import { logError } from "@/lib/log";
import { resolveViewScope } from "@/lib/viewScope";

export async function GET() {
  try {
    const { flavor, dataMode } = await resolveViewScope();
    const db = getDb();
    const configs: OptionRiskConfigs = { ...DEFAULT_OPTION_RISK_CONFIGS };
    const summary = loadOptionRiskSummary(db, {
      scope: latestSnapshotScopeForMode(dataMode),
      flavor,
      configs,
    });
    return NextResponse.json({ ok: true, ...summary });
  } catch (e) {
    logError("option_risk_get_failed", e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

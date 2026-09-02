import { NextResponse } from "next/server";

import { getConsolidatedAllocation } from "@/lib/analytics/allocation";
import { getUnderlyingExposureRollup } from "@/lib/analytics/optionsExposure";
import { getRebalancing } from "@/lib/analytics/rebalancing";
import { getAlertRules, insertAlertEvent, type AlertRuleType } from "@/lib/alerts";
import {
  DEFAULT_OPTION_RISK_CONFIGS,
  OPTION_RISK_RULE_TYPES,
  loadOptionRiskSummary,
  optionRiskEventsFromSummary,
  type OptionRiskConfigs,
  type OptionRiskRuleType,
} from "@/lib/alerts/optionRisk";
import { getDb } from "@/lib/db";
import { latestSnapshotScopeForMode } from "@/lib/holdings/latestSnapshots";
import { resolveViewScope } from "@/lib/viewScope";

export async function POST(req: Request) {
  const url = new URL(req.url);
  const includeSynthetic = url.searchParams.get("synthetic") !== "0";
  const { flavor, dataMode: mode } = await resolveViewScope();
  const rules = getAlertRules().filter((r) => r.enabled);

  let created = 0;

  for (const r of rules) {
    if (r.type === "drift") {
      const cfg = (r.config ?? {}) as { thresholdPct?: number };
      const threshold = cfg.thresholdPct ?? 0.05;
      const reb = getRebalancing(includeSynthetic, mode, undefined, flavor);
      const breached = reb.drift.filter((d) => Math.abs(d.drift) >= threshold);
      for (const b of breached) {
        created++;
        insertAlertEvent({
          ruleId: r.id,
          severity: Math.abs(b.drift) >= threshold * 2 ? "critical" : "warning",
          title: `Drift ${b.assetClass}: ${(b.drift * 100).toFixed(2)}%`,
          details: b,
        });
      }
    }

    if (r.type === "concentration") {
      const cfg = (r.config ?? {}) as { maxSingleUnderlyingPct?: number };
      const maxPct = cfg.maxSingleUnderlyingPct ?? 0.25;
      const alloc = getConsolidatedAllocation(includeSynthetic, mode, undefined, flavor);
      const exposure = getUnderlyingExposureRollup(mode, undefined, flavor);
      const total = alloc.totalMarketValue || exposure.reduce((s, e) => s + e.spotMarketValue + e.syntheticMarketValue, 0);
      for (const e of exposure) {
        const mv = e.spotMarketValue + (includeSynthetic ? e.syntheticMarketValue : 0);
        const pct = total ? mv / total : 0;
        if (pct >= maxPct) {
          created++;
          insertAlertEvent({
            ruleId: r.id,
            severity: pct >= maxPct * 1.5 ? "critical" : "warning",
            title: `Concentration ${e.underlyingSymbol}: ${(pct * 100).toFixed(2)}%`,
            details: { ...e, pct },
          });
        }
      }
    }
  }

  const optionEnabled = new Set(
    rules.map((r) => r.type).filter((t): t is OptionRiskRuleType => (OPTION_RISK_RULE_TYPES as readonly string[]).includes(t)),
  );
  if (optionEnabled.size > 0) {
    const merged: OptionRiskConfigs = { ...DEFAULT_OPTION_RISK_CONFIGS };
    for (const r of rules) {
      const cfg = (r.config ?? {}) as Partial<OptionRiskConfigs>;
      if (r.type === "delta-band") {
        if (typeof cfg.targetAbsDelta === "number") merged.targetAbsDelta = cfg.targetAbsDelta;
        if (typeof cfg.deltaBand === "number") merged.deltaBand = cfg.deltaBand;
      }
      if (r.type === "option-dte" && typeof (cfg as { maxDte?: number }).maxDte === "number") {
        merged.maxDte = (cfg as { maxDte: number }).maxDte;
      }
      if (r.type === "margin-pressure" && typeof cfg.maxMarginPct === "number") merged.maxMarginPct = cfg.maxMarginPct;
      if (r.type === "assignment" && typeof cfg.nearStrikePct === "number") merged.nearStrikePct = cfg.nearStrikePct;
    }
    const db = getDb();
    const summary = loadOptionRiskSummary(db, {
      scope: latestSnapshotScopeForMode(mode),
      flavor,
      configs: merged,
    });
    const drafts = optionRiskEventsFromSummary(summary, optionEnabled);
    const ruleIdByType = new Map(rules.map((r) => [r.type as AlertRuleType, r.id]));
    for (const ev of drafts) {
      const ruleId = ruleIdByType.get(ev.ruleType);
      if (!ruleId) continue;
      created++;
      insertAlertEvent({
        ruleId,
        severity: ev.severity,
        title: ev.title,
        details: ev.details,
      });
    }
  }

  return NextResponse.json({ ok: true, created });
}

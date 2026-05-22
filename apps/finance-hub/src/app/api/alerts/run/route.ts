import { NextResponse } from "next/server";

import { getConsolidatedAllocation } from "@/lib/analytics/allocation";
import { getUnderlyingExposureRollup } from "@/lib/analytics/optionsExposure";
import { getRebalancing } from "@/lib/analytics/rebalancing";
import { getAlertRules, insertAlertEvent } from "@/lib/alerts";

export async function POST(req: Request) {
  const url = new URL(req.url);
  const includeSynthetic = url.searchParams.get("synthetic") !== "0";
  const rules = getAlertRules().filter((r) => r.enabled);

  let created = 0;

  for (const r of rules) {
    if (r.type === "drift") {
      const cfg = (r.config ?? {}) as { thresholdPct?: number };
      const threshold = cfg.thresholdPct ?? 0.05;
      const reb = getRebalancing(includeSynthetic);
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
      const alloc = getConsolidatedAllocation(includeSynthetic);
      const exposure = getUnderlyingExposureRollup();
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

  return NextResponse.json({ ok: true, created });
}


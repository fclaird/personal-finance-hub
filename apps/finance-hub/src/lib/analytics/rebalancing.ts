import { getConsolidatedAllocation } from "@/lib/analytics/allocation";
import type { DataMode } from "@/lib/dataMode";
import { getGlobalTargets } from "@/lib/targets";

export type DriftRow = {
  assetClass: string;
  currentWeight: number;
  targetWeight: number;
  drift: number; // current - target
  currentMarketValue: number;
  targetMarketValue: number;
  suggestedDeltaMarketValue: number; // target - current (positive means buy/add)
};

export function getRebalancing(
  includeSynthetic: boolean,
  mode: DataMode = "auto",
  equityMarkMap?: Map<string, number>,
) {
  const alloc = getConsolidatedAllocation(includeSynthetic, mode, equityMarkMap);
  const targets = getGlobalTargets();

  const targetByClass = new Map<string, number>();
  for (const t of targets) targetByClass.set(t.assetClass, t.targetWeight);

  const currentByClass = new Map<string, { mv: number; w: number }>();
  for (const b of alloc.byAssetClass) currentByClass.set(b.key, { mv: b.marketValue, w: b.weight });

  const classes = new Set<string>([...currentByClass.keys(), ...targetByClass.keys()]);
  const out: DriftRow[] = [];
  for (const c of classes) {
    const cur = currentByClass.get(c);
    const targetW = targetByClass.get(c) ?? 0;
    const curW = cur?.w ?? 0;
    const curMv = cur?.mv ?? 0;
    const targetMv = alloc.totalMarketValue * targetW;
    out.push({
      assetClass: c,
      currentWeight: curW,
      targetWeight: targetW,
      drift: curW - targetW,
      currentMarketValue: curMv,
      targetMarketValue: targetMv,
      suggestedDeltaMarketValue: targetMv - curMv,
    });
  }

  out.sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift));

  return {
    includeSynthetic,
    totalMarketValue: alloc.totalMarketValue,
    drift: out,
  };
}


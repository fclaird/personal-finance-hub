export type ExposureRow = {
  underlyingSymbol: string;
  spotMarketValue: number;
  heldShares: number;
  syntheticMarketValue: number;
  syntheticShares: number;
  optionsMarkMarketValue: number;
};

export type ExposureScope = "net" | "brokerage" | "retirement";
export type ExposurePieMetric = "spot" | "synthetic" | "net";
export type SyntheticChartBasis = "delta" | "mark";

export const EXPOSURE_PIE_METRIC_LABEL: Record<ExposurePieMetric, string> = {
  spot: "Spot",
  synthetic: "Synthetic",
  net: "Net",
};

export function normalizeExposureRow(r: ExposureRow): ExposureRow {
  return {
    ...r,
    optionsMarkMarketValue: typeof r.optionsMarkMarketValue === "number" ? r.optionsMarkMarketValue : 0,
  };
}

export function sliceExposureMv(r: ExposureRow, metric: ExposurePieMetric): number {
  switch (metric) {
    case "spot":
      return r.spotMarketValue;
    case "synthetic":
      return r.syntheticMarketValue;
    case "net":
      return r.spotMarketValue + r.syntheticMarketValue;
    default:
      return 0;
  }
}

export function chartSyntheticMv(r: ExposureRow, basis: SyntheticChartBasis): number {
  return basis === "mark" ? r.optionsMarkMarketValue : r.syntheticMarketValue;
}

export function netLiquidatingMv(r: ExposureRow): number {
  return r.spotMarketValue + r.optionsMarkMarketValue;
}

export function scopeExposureRows(
  rows: ExposureRow[],
  buckets: Array<{ bucketKey: "brokerage" | "retirement"; exposure: ExposureRow[] }>,
  scope: ExposureScope,
): ExposureRow[] {
  if (scope === "net") return rows;
  const b = buckets.find((x) => x.bucketKey === scope);
  return b?.exposure ?? [];
}

export function chartScopedExposureRows(
  scopedRows: ExposureRow[],
  syntheticChartBasis: SyntheticChartBasis,
): ExposureRow[] {
  return scopedRows.map((r) => ({
    ...r,
    syntheticMarketValue: chartSyntheticMv(r, syntheticChartBasis),
  }));
}

/** Underlying symbol → tile size MV (same rules as allocation pie charts). */
export function exposureMvByUnderlying(
  scopedRows: ExposureRow[],
  pieMetric: ExposurePieMetric,
  syntheticChartBasis: SyntheticChartBasis,
): Map<string, number> {
  const chartRows = chartScopedExposureRows(scopedRows, syntheticChartBasis);
  const out = new Map<string, number>();
  for (const r of chartRows) {
    const sym = r.underlyingSymbol.toUpperCase().trim();
    if (!sym) continue;
    const mv = sliceExposureMv(r, pieMetric);
    if (!Number.isFinite(mv) || mv <= 0) continue;
    out.set(sym, (out.get(sym) ?? 0) + mv);
  }
  return out;
}

export function exposureScopeLabel(scope: ExposureScope): string {
  if (scope === "net") return "All";
  if (scope === "brokerage") return "Brokerage";
  return "Retirement";
}

export function exposureTileSizeCaption(
  scope: ExposureScope,
  pieMetric: ExposurePieMetric,
  syntheticChartBasis: SyntheticChartBasis,
): string {
  const scopeLabel = exposureScopeLabel(scope);
  const weightLabel = EXPOSURE_PIE_METRIC_LABEL[pieMetric];
  const markNote =
    pieMetric !== "spot" && syntheticChartBasis === "mark" ? " · option contract marks" : "";
  return `Tile area = ${scopeLabel} · ${weightLabel} market value${markNote}.`;
}

export function terminalTreemapSizeCaption(
  scope: ExposureScope,
  pieMetric: ExposurePieMetric,
  syntheticChartBasis: SyntheticChartBasis,
): string {
  return `${exposureTileSizeCaption(scope, pieMetric, syntheticChartBasis)} Color = today’s % change (same scale as heatmap).`;
}

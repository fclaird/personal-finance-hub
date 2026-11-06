import { sampleStructureDelta } from "@/lib/strategyLab/deltaCurves";
import { isPlottableStructure } from "@/lib/strategyLab/chartDisplay";
import type { LabEvaluation } from "@/lib/strategyLab/lab";

export type DeltaChartSource = "optimizer" | "analysis";

export const DELTA_SOURCE_LABEL: Record<DeltaChartSource, string> = {
  optimizer: "Optimizer spreads",
  analysis: "Main analysis",
};

export type DeltaSourceSeries = {
  readonly key: string;
  readonly name: string;
  readonly selected: boolean;
};

/**
 * Structures the main analysis can draw. A null plot list means every plottable structure.
 * The same ids feed the effective-delta chart when its source is the main analysis.
 */
export function analysisSeries(
  evaluation: LabEvaluation,
  plottedIds: readonly string[] | null,
): readonly { readonly id: string; readonly label: string; readonly slot: number }[] {
  const allow = plottedIds == null ? null : new Set(plottedIds);
  return evaluation.structures.filter(isPlottableStructure).flatMap((row) => {
    if (allow != null && !allow.has(row.spec.id)) return [];
    return [{ id: row.spec.id, label: row.spec.label, slot: row.spec.slot }];
  });
}

/** Share-equivalent delta, the same number the main analysis delta chart plots. */
export function analysisShareDelta(
  evaluation: LabEvaluation,
  structureId: string,
  horizonId: string,
  spot: number,
): number | null {
  return sampleStructureDelta(evaluation, structureId, horizonId, spot, "shares", "delta");
}

/** Series the effective-delta chart draws for the selected source. */
export function seriesForDeltaSource(
  source: DeltaChartSource,
  optimizer: readonly DeltaSourceSeries[],
  analysis: readonly { readonly key: string; readonly name: string }[],
): readonly DeltaSourceSeries[] {
  if (source === "analysis") return analysis.map((row) => ({ key: row.key, name: row.name, selected: false }));
  return optimizer.map((row) => ({ key: row.key, name: row.name, selected: row.selected }));
}

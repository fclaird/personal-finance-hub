import { calendarDaysBetween, type IsoDate, type OptionRight } from "@/lib/optionChain/chain";
import type { Assumptions, LabEvaluation } from "@/lib/strategyLab/lab";
import { packageShareDelta } from "@/lib/strategyLab/internal/pricing";
import { FLAT_DELTA_SHARES } from "@/lib/strategyLab/targetMetrics";

export type DeltaScale = "shares" | "package" | "pct";
export type DeltaMeasure = "delta" | "exposure" | "cost";

export type DeltaLeg = {
  readonly right: OptionRight;
  readonly strike: number;
  readonly ratio: number;
  readonly iv: number | null;
};

/**
 * Settled contract delta. A call is 1 at and above its strike. A put is −1 below its strike
 * and 0 at the strike, so a call spread is flat once the short strike is reached and a ZEBRA
 * is long 100 shares per package from that strike up.
 */
export function expiryUnitDelta(right: OptionRight, strike: number, spot: number): number {
  if (right === "C") return spot >= strike ? 1 : 0;
  return spot < strike ? -1 : 0;
}

/** One package, in share-equivalents, at expiry. Exact 0/1 steps, not a slope across a dollar. */
export function packageExpiryDelta(
  legs: readonly { right: OptionRight; strike: number; ratio: number }[],
  spot: number,
): number {
  let sum = 0;
  for (const leg of legs) sum += expiryUnitDelta(leg.right, leg.strike, spot) * leg.ratio * 100;
  return sum;
}

/**
 * Net share-equivalents. Before expiry each leg keeps its entry IV at every spot (sticky strike).
 * A stock leg is shares, not a contract multiplier. Missing IV before expiry leaves a gap.
 */
export function positionShareDelta(input: {
  readonly legs: readonly DeltaLeg[];
  readonly stockSharesPerPackage?: number;
  readonly packages: number;
  readonly assumptions: Assumptions;
  readonly spot: number;
  readonly years: number;
}): number | null {
  const stock = (input.stockSharesPerPackage ?? 0) * input.packages;
  if (!(input.years > 1e-8)) return packageExpiryDelta(input.legs, input.spot) * input.packages + stock;
  if (input.legs.length === 0) return stock;
  const pkg = packageShareDelta(input.legs, input.assumptions, input.spot, input.years);
  if (pkg == null) return null;
  return pkg * input.packages + stock;
}

/**
 * Scale and unit for the delta chart.
 * Shares and “% of 100” are the same numbers (100 shares reads as 100%).
 * Per package divides by the package count. Dollar exposure is that delta times spot.
 * Cost per delta is dollars invested over that delta, and breaks when the delta is under one share.
 */
export function presentDelta(
  positionShares: number,
  packages: number,
  invested: number,
  spot: number,
  scale: DeltaScale,
  measure: DeltaMeasure,
): number | null {
  if (!Number.isFinite(positionShares) || !Number.isFinite(spot)) return null;
  const scaled = scale === "package" ? (packages !== 0 ? positionShares / packages : null) : positionShares;
  if (scaled == null || !Number.isFinite(scaled)) return null;
  if (measure === "exposure") return scaled * spot;
  if (measure === "cost") {
    if (Math.abs(scaled) < FLAT_DELTA_SHARES) return null;
    const dollars = scale === "package" ? (packages !== 0 ? invested / packages : invested) : invested;
    return dollars / scaled;
  }
  return scaled;
}

export function comparisonCapital(evaluation: Pick<LabEvaluation, "basis" | "match" | "spot">): number {
  if (evaluation.basis.kind === "equalCapital") return evaluation.basis.capital;
  return evaluation.match?.capital ?? evaluation.spot * 100;
}

function pricedRow(evaluation: LabEvaluation, structureId: string) {
  const row = evaluation.structures.find((item) => item.status === "priced" && item.spec.id === structureId);
  if (!row || row.status !== "priced" || row.sizing.status === "needsCapitalOverride") return null;
  return { row, packages: row.sizing.packages, invested: row.sizing.invested };
}

export function isExpiryCurve(evaluation: LabEvaluation, structureId: string, horizonId: string): boolean {
  const sized = pricedRow(evaluation, structureId);
  const horizon = evaluation.horizons.find((item) => item.id === horizonId);
  if (!sized || !horizon) return false;
  return horizon.settlement || calendarDaysBetween(horizon.date, sized.row.spec.expiry) <= 0;
}

function yearsToHorizon(expiry: IsoDate, evaluation: LabEvaluation, horizonId: string): number | null {
  const horizon = evaluation.horizons.find((item) => item.id === horizonId);
  if (!horizon) return null;
  if (horizon.settlement || calendarDaysBetween(horizon.date, expiry) <= 0) return 0;
  return calendarDaysBetween(horizon.date, expiry) / 365;
}

export function sampleStructureDelta(
  evaluation: LabEvaluation,
  structureId: string,
  horizonId: string,
  spot: number,
  scale: DeltaScale,
  measure: DeltaMeasure,
): number | null {
  const sized = pricedRow(evaluation, structureId);
  if (!sized) return null;
  const years = yearsToHorizon(sized.row.spec.expiry, evaluation, horizonId);
  if (years == null) return null;
  const shares = positionShareDelta({
    legs: sized.row.legs,
    packages: sized.packages,
    assumptions: evaluation.assumptions,
    spot,
    years,
  });
  if (shares == null) return null;
  return presentDelta(shares, sized.packages, sized.invested, spot, scale, measure);
}

/** The comparison stock line: capital buys this many shares, and that count does not change with price. */
export function sampleStockDelta(
  evaluation: LabEvaluation,
  spot: number,
  scale: DeltaScale,
  measure: DeltaMeasure,
): number | null {
  if (!(evaluation.spot > 0)) return null;
  const capital = comparisonCapital(evaluation);
  const shares = capital / evaluation.spot;
  return presentDelta(shares, 1, capital, spot, scale, measure);
}

/** Dotted guides. On the share scale, each distinct package count also gets a 100×packages line. */
export function hundredLines(scale: DeltaScale, packageCounts: readonly number[]): { y: number; label: string }[] {
  if (scale === "package") return [{ y: 100, label: "100 / pkg" }];
  if (scale === "pct") return [{ y: 100, label: "100%" }];
  const lines = [{ y: 100, label: "100 shares" }];
  const seen = new Set<number>();
  for (const packages of packageCounts) {
    if (!(packages > 0) || Math.abs(packages - 1) < 1e-6) continue;
    const key = Math.round(packages * 1e6);
    if (seen.has(key)) continue;
    seen.add(key);
    const rounded = Math.round(packages * 100) / 100;
    lines.push({ y: 100 * packages, label: `${rounded}×100` });
  }
  return lines;
}

/** First spot that attains the highest plotted value. Ties keep the left-hand price. */
export function peakDelta(points: readonly { spot: number; value: number | null }[]): { spot: number; value: number } | null {
  let best: { spot: number; value: number } | null = null;
  for (const point of points) {
    if (point.value == null || !Number.isFinite(point.value)) continue;
    if (best == null || point.value > best.value) best = { spot: point.spot, value: point.value };
  }
  return best;
}

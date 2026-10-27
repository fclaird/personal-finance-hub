/**
 * Which P&L curves the one Strategy Lab chart draws.
 * Pure and instant: the page never refetches when Chris changes mode, dates, or structures.
 */

import { calendarDaysBetween, formatExpiryLabel, type IsoDate } from "@/lib/optionChain/chain";
import {
  crossoverText,
  type ExpiryCrossover,
  type HorizonView,
  type LabEvaluation,
  type PricedStructure,
} from "@/lib/strategyLab/lab";
import { structureDisplayNames } from "@/lib/strategyLab/displayNames";
import { seriesColor } from "@/lib/strategyLab/palette";

export const CHART_MODES = [
  { id: "waterfall", label: "Waterfall" },
  { id: "single", label: "Single date" },
] as const;

export type ChartMode = (typeof CHART_MODES)[number]["id"];

export type HorizonPolicy =
  | { readonly kind: "readable" }
  | { readonly kind: "all" }
  | { readonly kind: "none" }
  | { readonly kind: "every"; readonly step: 2 | 4 }
  | { readonly kind: "expiryPlus" }
  | { readonly kind: "picked"; readonly indexes: readonly number[] };

export type ChartSelection = {
  mode: ChartMode;
  structureIds: readonly string[];
  horizonIds: readonly string[];
  horizonPolicy: HorizonPolicy;
  /** Structure whose dates the waterfall draws. Single date draws every selected structure. */
  focusStructureId: string | null;
  /** The one date drawn in Single date. */
  focusHorizonId: string | null;
};

export type CurveLook = {
  colorMode: "rainbow" | "structure";
  stroke: "solid" | "dashed";
  thickness: number;
};

export type ChartChrome = {
  thickness: number;
  dimOpacity: number;
  colorMode: "rainbow" | "structure";
  stroke: "solid" | "dashed";
  yAxis: { kind: "auto" } | { kind: "manual"; min: number; max: number };
  showStock: boolean;
  showStrikes: boolean;
  showBreakevens: boolean;
  showCrossovers: boolean;
  showZones: boolean;
  focusedCurveKey: string | null;
};

export type StoredChartSettings = {
  mode: ChartMode;
  horizonPolicy: HorizonPolicy;
  chrome: ChartChrome;
};

export const CHART_SETTINGS_KEY = "fh.strategyLab.chart.v1";

export type CurveView = {
  key: string;
  structureId: string;
  horizonId: string;
  name: string;
  color: string;
  width: number;
  dash?: string;
};

export type CrossoverCallout = {
  n: number;
  spot: number;
  text: string;
  structureId: string;
  horizonId: string;
  model: boolean;
};

type KnownIds = {
  structures: readonly string[];
  horizons: readonly string[];
};

const DATE_DASH = ["4 3", "1 3", "8 4", "2 2", "6 3"] as const;

const LONG_DATE = /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) /;

/** Chip and legend text. A long weekday date drops off. `E−2wk · Jun 4` stays whole. */
export function shortHorizon(label: string): string {
  const parts = label.split(" · ");
  if (parts.length >= 2 && LONG_DATE.test(parts[1] ?? "")) return parts[0] ?? label;
  return label;
}

/** t = 0 is today (cyan). t = 1 is expiry (magenta). Used when a single-date chart is set to rainbow. */
export function rainbowColor(t: number): string {
  const clamped = Math.min(1, Math.max(0, t));
  const hue = ((188 - clamped * 228) % 360 + 360) % 360;
  return hslToHex(hue, 0.92, 0.64);
}

/**
 * Cool-to-warm ramp for a waterfall of dates on near-black.
 * t = 0 is the earliest date (steel blue). t = 1 is the latest pre-expiry date (amber).
 * Saturation stays moderate so the steps read as one sequence, not a neon wheel.
 */
export function dateRampColor(t: number): string {
  const clamped = Math.min(1, Math.max(0, t));
  const hue = 206 - clamped * (206 - 36);
  const sat = 0.46 + clamped * 0.16;
  const light = 0.66 + clamped * 0.06;
  return hslToHex(hue, sat, light);
}

/** Expiry sits off the ramp: near-white, so it stays obvious against the amber end. */
export const EXPIRY_RAMP_COLOR = "#f4f4f5";

const DATE_LINE_WIDTH = 3;
const EXPIRY_LINE_WIDTH = 4.5;

export function initialChartSelection(evaluation: LabEvaluation): ChartSelection {
  const structures = pricedStructures(evaluation).map((row) => row.spec.id);
  const horizons = [...evaluation.horizons].sort(byDate);
  const middle = horizons.find((horizon) => !isToday(evaluation, horizon) && !horizon.settlement);
  return {
    mode: "waterfall",
    structureIds: structures,
    horizonIds: readableHorizonIds(horizons),
    horizonPolicy: { kind: "readable" },
    focusStructureId: structures[0] ?? null,
    focusHorizonId: middle?.id ?? horizons[0]?.id ?? null,
  };
}

export function toggleStructure(selection: ChartSelection, id: string): ChartSelection {
  const on = selection.structureIds.includes(id);
  const structureIds = on ? selection.structureIds.filter((item) => item !== id) : [...selection.structureIds, id];
  const focusStructureId = on
    ? selection.focusStructureId === id
      ? (structureIds[0] ?? null)
      : selection.focusStructureId
    : id;
  return { ...selection, structureIds, focusStructureId };
}

export function setStructures(selection: ChartSelection, ids: readonly string[]): ChartSelection {
  const structureIds = [...ids];
  const focusStructureId = structureIds.includes(selection.focusStructureId ?? "")
    ? selection.focusStructureId
    : (structureIds[0] ?? null);
  return { ...selection, structureIds, focusStructureId };
}

export function toggleHorizon(selection: ChartSelection, id: string, horizons: readonly HorizonView[] = []): ChartSelection {
  const horizonIds = selection.horizonIds.includes(id)
    ? selection.horizonIds.filter((item) => item !== id)
    : [...selection.horizonIds, id];
  return { ...selection, horizonIds, horizonPolicy: policyFromIds(horizons, horizonIds) };
}

export function setHorizons(selection: ChartSelection, ids: readonly string[], policy?: HorizonPolicy): ChartSelection {
  return { ...selection, horizonIds: [...ids], horizonPolicy: policy ?? { kind: "picked", indexes: [] } };
}

export function applyHorizonPolicy(horizons: readonly HorizonView[], policy: HorizonPolicy, focusHorizonId: string | null): string[] {
  const sorted = [...horizons].sort(byDate);
  switch (policy.kind) {
    case "readable":
      return readableHorizonIds(sorted);
    case "all":
      return sorted.map((horizon) => horizon.id);
    case "none":
      return [];
    case "every":
      return everyNthHorizonIds(sorted, policy.step);
    case "expiryPlus":
      return expiryPlusOneIds(sorted, focusHorizonId);
    case "picked":
      return policy.indexes.flatMap((index) => {
        const horizon = sorted[index];
        return horizon ? [horizon.id] : [];
      });
    default:
      return readableHorizonIds(sorted);
  }
}

/** Today, about three quarters, and expiry. Five curves at most. */
export function readableHorizonIds(horizons: readonly HorizonView[]): string[] {
  const sorted = [...horizons].sort(byDate);
  if (sorted.length <= 5) return sorted.map((horizon) => horizon.id);
  const last = sorted.length - 1;
  const mids = [1, 2, 3]
    .map((step) => Math.round((last * step) / 4))
    .filter((index) => index > 0 && index < last);
  return [...new Set([0, ...mids, last])].sort((a, b) => a - b).map((index) => sorted[index]!.id);
}

export function everyNthHorizonIds(horizons: readonly HorizonView[], step: 2 | 4): string[] {
  const sorted = [...horizons].sort(byDate);
  const ids = sorted.filter((_, index) => index % step === 0).map((horizon) => horizon.id);
  const expiry = [...sorted].reverse().find((horizon) => horizon.settlement);
  if (expiry && !ids.includes(expiry.id)) ids.push(expiry.id);
  return ids;
}

export function expiryPlusOneIds(horizons: readonly HorizonView[], focusHorizonId: string | null): string[] {
  const sorted = [...horizons].sort(byDate);
  const expiry = sorted.find((horizon) => horizon.settlement);
  const chosen =
    sorted.find((horizon) => horizon.id === focusHorizonId && !horizon.settlement) ??
    sorted.find((horizon) => !horizon.settlement && horizon.id !== sorted[0]?.id) ??
    sorted.find((horizon) => !horizon.settlement);
  const picked = [chosen, expiry].filter((horizon): horizon is HorizonView => horizon != null);
  return picked.filter((horizon, index) => picked.findIndex((item) => item.id === horizon.id) === index).map((horizon) => horizon.id);
}

export function policyFromIds(horizons: readonly HorizonView[], ids: readonly string[]): HorizonPolicy {
  const sorted = [...horizons].sort(byDate);
  const indexes = sorted.flatMap((horizon, index) => (ids.includes(horizon.id) ? [index] : []));
  return { kind: "picked", indexes };
}

export function setChartMode(selection: ChartSelection, mode: ChartMode): ChartSelection {
  if (mode !== "single") return { ...selection, mode: "waterfall" };
  const id = selection.focusHorizonId ?? selection.horizonIds[0] ?? null;
  return { ...selection, mode: "single", focusHorizonId: id, horizonIds: id ? [id] : [] };
}

export function setFocusHorizon(selection: ChartSelection, id: string): ChartSelection {
  return { ...selection, focusHorizonId: id };
}

/** Single date replaces the previous date. The chart never keeps two dates from this picker. */
export function selectDate(selection: ChartSelection, id: string, horizons: readonly HorizonView[] = []): ChartSelection {
  const sorted = [...horizons].sort(byDate);
  const index = sorted.findIndex((horizon) => horizon.id === id);
  return {
    ...selection,
    mode: "single",
    focusHorizonId: id,
    horizonIds: [id],
    horizonPolicy: { kind: "picked", indexes: index >= 0 ? [index] : [] },
  };
}

/**
 * Keep a cleared or narrowed selection when the chain refreshes.
 * Structures and dates that were not on the previous evaluation are selected.
 */
export function reconcileChartSelection(prev: ChartSelection, live: KnownIds, known: KnownIds): ChartSelection {
  const structureIds = mergeIds(prev.structureIds, live.structures, known.structures);
  const horizonIds = mergeIds(prev.horizonIds, live.horizons, known.horizons);
  const focusStructureId = structureIds.includes(prev.focusStructureId ?? "")
    ? prev.focusStructureId
    : (structureIds[0] ?? null);
  const focusHorizonId = live.horizons.includes(prev.focusHorizonId ?? "")
    ? prev.focusHorizonId
    : pickMiddleHorizon(live.horizons);
  return { ...prev, structureIds, horizonIds, focusStructureId, focusHorizonId };
}

export function visibleCurves(evaluation: LabEvaluation, selection: ChartSelection, look?: CurveLook): CurveView[] {
  const painted = paintMode(evaluation, selection);
  if (!look) return painted;
  return selection.mode === "waterfall" ? painted : applyCurveLook(painted, look, evaluation);
}

/**
 * Curves the P&L chart actually strokes.
 * Waterfall keeps one ramp color per date. Running those curves through the
 * structure/solid look collapses every date of one structure onto one solid line.
 */
export function displayedCurves(evaluation: LabEvaluation, selection: ChartSelection, look: CurveLook): CurveView[] {
  const painted = paintMode(evaluation, selection);
  if (selection.mode === "waterfall") {
    return painted.map((curve) => {
      const expiry = curve.color === EXPIRY_RAMP_COLOR;
      const width = Math.max(DATE_LINE_WIDTH, look.thickness);
      return { ...curve, width: expiry ? width + (EXPIRY_LINE_WIDTH - DATE_LINE_WIDTH) : width, dash: undefined };
    });
  }
  return applyCurveLook(painted, look, evaluation);
}

function displayOf(evaluation: LabEvaluation): ReadonlyMap<string, string> {
  return structureDisplayNames(evaluation.structures.map((row) => ({ id: row.spec.id, label: row.spec.label })));
}

function paintMode(evaluation: LabEvaluation, selection: ChartSelection): CurveView[] {
  const structures = selectedStructures(evaluation, selection);
  if (structures.length === 0) return [];
  const focus = structures.find((row) => row.spec.id === selection.focusStructureId) ?? structures[0]!;

  switch (selection.mode) {
    case "waterfall":
      return paintWaterfall(focus, structureHorizons(evaluation, focus));
    case "single":
      return curvesOnFocusDate(evaluation, selection);
    default:
      return [];
  }
}

/** Line thickness, dash, and color from the chart controls. Waterfall keeps its own colors. */
export function applyCurveLook(curves: readonly CurveView[], look: CurveLook, evaluation: LabEvaluation): CurveView[] {
  return curves.map((curve, index) => {
    const expiry = evaluation.horizons.some((horizon) => horizon.id === curve.horizonId && horizon.settlement);
    const slot = evaluation.structures.find((row) => row.spec.id === curve.structureId)?.spec.slot ?? index;
    const color =
      look.colorMode === "rainbow"
        ? rainbowColor(curves.length <= 1 ? 1 : index / (curves.length - 1))
        : seriesColor(slot);
    return {
      ...curve,
      color,
      width: look.thickness + (expiry ? 1 : 0),
      dash: look.stroke === "solid" || expiry ? undefined : (curve.dash ?? "6 3"),
    };
  });
}

/** Every selected structure on one date. That is the By structure chart. */
export function combinedDateCurves(evaluation: LabEvaluation, selection: ChartSelection): CurveView[] {
  return curvesOnFocusDate(evaluation, selection);
}

function curvesOnFocusDate(evaluation: LabEvaluation, selection: ChartSelection): CurveView[] {
  const structures = selectedStructures(evaluation, selection);
  if (structures.length === 0) return [];
  const known = new Set(evaluation.horizons.map((horizon) => horizon.id));
  const horizonId =
    (selection.focusHorizonId && known.has(selection.focusHorizonId) ? selection.focusHorizonId : null) ??
    selection.horizonIds.find((id) => known.has(id)) ??
    evaluation.horizons[0]?.id ??
    null;
  if (!horizonId) return [];
  const names = displayOf(evaluation);
  return structures.flatMap((row) => {
    const chosen = horizonForStructure(evaluation, row, horizonId);
    return chosen ? paint(row, [chosen], "palette", names.get(row.spec.id) ?? row.spec.label) : [];
  });
}

/** One structure's forward date steps, drawn as the waterfall. A zero-package structure contributes nothing. */
export function structurePanelCurves(evaluation: LabEvaluation, selection: ChartSelection, structureId: string): CurveView[] {
  if (!selection.structureIds.includes(structureId)) return [];
  return visibleCurves(evaluation, {
    ...selection,
    mode: "waterfall",
    structureIds: [structureId],
    focusStructureId: structureId,
  });
}

/** One stock line: expiry when several dates are drawn, otherwise the only visible date. */
export function stockHorizonId(evaluation: LabEvaluation, curves: readonly CurveView[]): string | null {
  if (evaluation.stock.length === 0 || curves.length === 0) return null;
  const horizonIds = [...new Set(curves.map((curve) => curve.horizonId))];
  const settlement = horizonIds.find(
    (id) => evaluation.horizons.some((horizon) => horizon.id === id && horizon.settlement) && evaluation.stock.some((series) => series.horizonId === id),
  );
  if (settlement && horizonIds.length > 1) return settlement;
  if (horizonIds.length === 1 && evaluation.stock.some((series) => series.horizonId === horizonIds[0])) return horizonIds[0]!;
  return null;
}

export function crossoverCallouts(
  evaluation: LabEvaluation,
  curves: readonly CurveView[],
  window?: { min: number; max: number },
): CrossoverCallout[] {
  const groups = new Map<string, CurveView[]>();
  for (const curve of curves) {
    const list = groups.get(curve.horizonId) ?? [];
    list.push(curve);
    groups.set(curve.horizonId, list);
  }
  const horizonOrder = new Map(evaluation.horizons.map((horizon, index) => [horizon.id, index]));
  const pending: Omit<CrossoverCallout, "n">[] = [];
  const seen = new Set<string>();
  for (const [horizonId, group] of groups) {
    if (group.length < 2) continue;
    const ids = new Set(group.map((curve) => curve.structureId));
    const horizon = evaluation.horizons.find((item) => item.id === horizonId);
    const hits: { crossover: ExpiryCrossover; model: boolean }[] = [];
    if (horizon?.settlement) {
      for (const board of evaluation.expiryBoards) {
        if (!board.exact) continue;
        for (const crossover of board.crossovers) {
          if (ids.has(crossover.overtakesId) && ids.has(crossover.overtakenId)) hits.push({ crossover, model: false });
        }
      }
    } else {
      for (const crossover of evaluation.modelCrossovers) {
        if (crossover.horizonId !== horizonId) continue;
        if (ids.has(crossover.overtakesId) && ids.has(crossover.overtakenId)) hits.push({ crossover, model: true });
      }
    }
    const multiDate = [...groups.values()].filter((rows) => rows.length >= 2).length > 1;
    for (const hit of hits) {
      const key = `${horizonId}|${hit.crossover.overtakesId}|${hit.crossover.overtakenId}|${hit.crossover.spot.toFixed(4)}`;
      if (seen.has(key)) continue;
      if (window && (hit.crossover.spot < window.min || hit.crossover.spot > window.max)) continue;
      seen.add(key);
      const dated = multiDate && horizon ? ` · ${shortHorizon(horizon.label)}` : "";
      const model = hit.model ? " (model)" : "";
      pending.push({
        spot: hit.crossover.spot,
        text: `${crossoverText(hit.crossover)}${dated}${model}`,
        structureId: hit.crossover.overtakesId,
        horizonId,
        model: hit.model,
      });
    }
  }
  pending.sort((a, b) => (horizonOrder.get(a.horizonId) ?? 0) - (horizonOrder.get(b.horizonId) ?? 0) || a.spot - b.spot);
  return pending.map((callout, index) => ({ ...callout, n: index + 1 }));
}

export type ProfitCrossover = { readonly spot: number; readonly pnl: number };

/**
 * Crossovers of the plotted curves whose intersection is in profit (P&L above zero).
 * Loss-side crossings are omitted so the default zoom can sit on the profit side.
 */
export function positiveCrossovers(evaluation: LabEvaluation, curves: readonly CurveView[]): ProfitCrossover[] {
  const priced = evaluation.structures.filter(isPlottableStructure);
  const byHorizon = new Map<string, CurveView[]>();
  for (const curve of curves) {
    const list = byHorizon.get(curve.horizonId) ?? [];
    list.push(curve);
    byHorizon.set(curve.horizonId, list);
  }
  const out: ProfitCrossover[] = [];
  const seen = new Set<string>();
  for (const callout of crossoverCallouts(evaluation, curves)) {
    const key = `${callout.horizonId}|${callout.spot.toFixed(4)}`;
    if (seen.has(key)) continue;
    const pnl = intersectionPnl(priced, byHorizon.get(callout.horizonId) ?? [], callout.spot);
    if (pnl == null || !(pnl > 0)) continue;
    seen.add(key);
    out.push({ spot: callout.spot, pnl });
  }
  return out;
}

function intersectionPnl(priced: readonly PricedStructure[], curves: readonly CurveView[], spot: number): number | null {
  const values: number[] = [];
  for (const curve of curves) {
    const points = priced
      .find((row) => row.spec.id === curve.structureId)
      ?.curves.find((item) => item.horizonId === curve.horizonId)?.points;
    if (!points || points.length === 0) continue;
    const first = points[0]!.spot;
    const last = points[points.length - 1]!.spot;
    if (spot < first - 1e-6 || spot > last + 1e-6) continue;
    const pnl = samplePnl(points, spot);
    if (pnl != null && Number.isFinite(pnl)) values.push(pnl);
  }
  if (values.length < 2) return null;
  let bestGap = Infinity;
  let average = 0;
  for (let i = 0; i < values.length; i++) {
    for (let j = i + 1; j < values.length; j++) {
      const gap = Math.abs(values[i]! - values[j]!);
      if (gap < bestGap) {
        bestGap = gap;
        average = (values[i]! + values[j]!) / 2;
      }
    }
  }
  return average;
}

export function samplePnl(points: readonly { spot: number; pnl: number }[], spot: number): number | null {
  if (points.length === 0) return null;
  if (spot <= points[0]!.spot) return points[0]!.pnl;
  const last = points[points.length - 1]!;
  if (spot >= last.spot) return last.pnl;
  for (let i = 0; i < points.length - 1; i++) {
    const left = points[i]!;
    const right = points[i + 1]!;
    if (spot < left.spot || spot > right.spot) continue;
    const span = right.spot - left.spot;
    const t = span === 0 ? 0 : (spot - left.spot) / span;
    return left.pnl + (right.pnl - left.pnl) * t;
  }
  return null;
}

function paintWaterfall(row: PricedStructure, horizons: readonly HorizonView[]): CurveView[] {
  const dated = Math.max(horizons.filter((horizon) => !horizon.settlement).length - 1, 1);
  let datedIndex = 0;
  return horizons.map((horizon) => {
    const expiry = horizon.settlement;
    const t = expiry ? 1 : datedIndex / dated;
    if (!expiry) datedIndex += 1;
    return {
      key: `${row.spec.id}@@${horizon.id}`,
      structureId: row.spec.id,
      horizonId: horizon.id,
      name: shortHorizon(horizon.label),
      color: expiry ? EXPIRY_RAMP_COLOR : dateRampColor(t),
      width: expiry ? EXPIRY_LINE_WIDTH : DATE_LINE_WIDTH,
    };
  });
}

function paint(row: PricedStructure, horizons: readonly HorizonView[], kind: "rainbow" | "palette", label: string): CurveView[] {
  return horizons.map((horizon, index) => {
    const look = lookOf(row, horizon, index, horizons.length, kind);
    const many = horizons.length > 1 || kind === "rainbow";
    return {
      key: `${row.spec.id}@@${horizon.id}`,
      structureId: row.spec.id,
      horizonId: horizon.id,
      name: curveName(label, row.spec.expiry, horizon, many),
      ...look,
    };
  });
}

function lookOf(
  row: PricedStructure,
  horizon: HorizonView,
  index: number,
  total: number,
  kind: "rainbow" | "palette",
): { color: string; width: number; dash?: string } {
  const expiry = horizon.settlement || (kind === "rainbow" && index === total - 1);
  if (kind === "rainbow") {
    const t = total <= 1 ? 1 : index / (total - 1);
    return { color: rainbowColor(t), width: expiry ? 4 : 2.75 };
  }
  const color = seriesColor(row.spec.slot);
  if (total <= 1) return { color, width: horizon.settlement ? 4 : 3.5 };
  if (horizon.settlement) return { color, width: 4 };
  return { color, width: 2.75, dash: DATE_DASH[index % DATE_DASH.length] };
}

export function isPlottableStructure(row: LabEvaluation["structures"][number]): row is PricedStructure {
  return row.status === "priced" && row.curves.length > 0 && !(row.sizing.status === "sized" && row.sizing.packages === 0);
}

function pricedStructures(evaluation: LabEvaluation): PricedStructure[] {
  return evaluation.structures.filter(isPlottableStructure);
}

function selectedStructures(evaluation: LabEvaluation, selection: ChartSelection): PricedStructure[] {
  const byId = new Map(pricedStructures(evaluation).map((row) => [row.spec.id, row]));
  return selection.structureIds.flatMap((id) => {
    const row = byId.get(id);
    return row ? [row] : [];
  });
}

function structureHorizons(evaluation: LabEvaluation, row: PricedStructure): HorizonView[] {
  const ids = new Set(row.curves.map((curve) => curve.horizonId));
  return evaluation.horizons.filter((horizon) => ids.has(horizon.id)).sort(byDate);
}

/**
 * A shared date uses that calendar day and each structure's own time to expiry.
 * A shared expiry pick uses each structure's own settlement, even when the expiries differ.
 */
function horizonForStructure(evaluation: LabEvaluation, row: PricedStructure, horizonId: string | null): HorizonView | null {
  const horizons = structureHorizons(evaluation, row);
  if (horizons.length === 0) return null;
  if (!horizonId) return horizons[0] ?? null;
  const exact = horizons.find((horizon) => horizon.id === horizonId);
  if (exact) return exact;
  const focus = evaluation.horizons.find((horizon) => horizon.id === horizonId);
  if (!focus) return horizons[0] ?? null;
  if (focus.settlement) return horizons.find((horizon) => horizon.settlement) ?? null;
  return horizons.find((horizon) => horizon.date === focus.date && !horizon.settlement) ?? horizons.find((horizon) => horizon.date === focus.date) ?? null;
}

function curveName(label: string, expiry: IsoDate, horizon: HorizonView, many: boolean): string {
  if (horizon.settlement || calendarDaysBetween(horizon.date, expiry) <= 0) {
    return `${label} · expiry ${formatExpiryLabel(expiry)}`;
  }
  return many ? `${label} · ${shortHorizon(horizon.label)}` : label;
}

function isToday(evaluation: LabEvaluation, horizon: HorizonView): boolean {
  return !horizon.settlement && horizon.date === evaluation.entryDate;
}

function byDate(a: HorizonView, b: HorizonView): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.settlement !== b.settlement) return a.settlement ? 1 : -1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function mergeIds(selected: readonly string[], live: readonly string[], known: readonly string[]): string[] {
  const kept = selected.filter((id) => live.includes(id));
  const newcomers = live.filter((id) => !known.includes(id) && !kept.includes(id));
  return [...kept, ...newcomers];
}

function pickMiddleHorizon(ids: readonly string[]): string | null {
  return ids[Math.min(1, Math.max(ids.length - 1, 0))] ?? null;
}

export function defaultChartChrome(): ChartChrome {
  return {
    thickness: 3,
    dimOpacity: 0.28,
    colorMode: "structure",
    stroke: "solid",
    yAxis: { kind: "auto" },
    showStock: true,
    showStrikes: false,
    showBreakevens: false,
    showCrossovers: true,
    showZones: false,
    focusedCurveKey: null,
  };
}

/** Older blobs picked several dates at once. Those open on the waterfall. One-date modes open on Single date. */
function savedChartMode(raw: unknown): ChartMode | null {
  if (raw === "waterfall" || raw === "quarters" || raw === "custom") return "waterfall";
  if (raw === "single" || raw === "structure" || raw === "dateOverlay" || raw === "today" || raw === "expiry" || raw === "span" || raw === "overlay") {
    return "single";
  }
  return null;
}

export function parseChartSettings(raw: unknown): StoredChartSettings | null {
  try {
    if (!isRecord(raw) || raw.v !== 1) return null;
    const horizonPolicy = parseHorizonPolicy(raw.horizonPolicy);
    const chrome = parseChrome(raw.chrome);
    if (!horizonPolicy || !chrome) return null;
    const mode = savedChartMode(raw.mode);
    if (!mode) return null;
    return { mode, horizonPolicy, chrome };
  } catch {
    return null;
  }
}

export function readChartSettings(storage: Pick<Storage, "getItem">): StoredChartSettings | null {
  try {
    const text = storage.getItem(CHART_SETTINGS_KEY);
    if (!text) return null;
    return parseChartSettings(JSON.parse(text) as unknown);
  } catch {
    return null;
  }
}

export function writeChartSettings(storage: Pick<Storage, "setItem">, settings: StoredChartSettings): void {
  storage.setItem(CHART_SETTINGS_KEY, JSON.stringify({ v: 1, ...settings }));
}

function parseHorizonPolicy(raw: unknown): HorizonPolicy | null {
  if (!isRecord(raw) || typeof raw.kind !== "string") return null;
  if (raw.kind === "readable" || raw.kind === "all" || raw.kind === "none" || raw.kind === "expiryPlus") return { kind: raw.kind };
  if (raw.kind === "every" && (raw.step === 2 || raw.step === 4)) return { kind: "every", step: raw.step };
  if (raw.kind === "picked" && Array.isArray(raw.indexes) && raw.indexes.every((index) => Number.isInteger(index) && index >= 0 && index < 40)) {
    return { kind: "picked", indexes: raw.indexes as number[] };
  }
  return null;
}

function parseChrome(raw: unknown): ChartChrome | null {
  if (!isRecord(raw)) return null;
  const thickness = finite(raw.thickness);
  const dimOpacity = finite(raw.dimOpacity);
  if (thickness == null || thickness < 1.5 || thickness > 6) return null;
  if (dimOpacity == null || dimOpacity < 0.05 || dimOpacity > 1) return null;
  if (raw.colorMode !== "rainbow" && raw.colorMode !== "structure") return null;
  if (raw.stroke !== "solid" && raw.stroke !== "dashed") return null;
  if (typeof raw.showStock !== "boolean" || typeof raw.showStrikes !== "boolean") return null;
  if (typeof raw.showBreakevens !== "boolean" || typeof raw.showCrossovers !== "boolean" || typeof raw.showZones !== "boolean") return null;
  const yAxis = parseYAxis(raw.yAxis);
  if (!yAxis) return null;
  const focusedCurveKey = raw.focusedCurveKey == null ? null : typeof raw.focusedCurveKey === "string" && raw.focusedCurveKey.length < 80 ? raw.focusedCurveKey : null;
  if (raw.focusedCurveKey != null && focusedCurveKey == null) return null;
  return {
    thickness,
    dimOpacity,
    colorMode: raw.colorMode,
    stroke: raw.stroke,
    yAxis,
    showStock: raw.showStock,
    showStrikes: raw.showStrikes,
    showBreakevens: raw.showBreakevens,
    showCrossovers: raw.showCrossovers,
    showZones: raw.showZones,
    focusedCurveKey,
  };
}

function parseYAxis(raw: unknown): ChartChrome["yAxis"] | null {
  if (!isRecord(raw)) return null;
  if (raw.kind === "auto") return { kind: "auto" };
  if (raw.kind !== "manual") return null;
  const min = finite(raw.min);
  const max = finite(raw.max);
  if (min == null || max == null || !(max > min)) return null;
  return { kind: "manual", min, max };
}

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return raw != null && typeof raw === "object" && !Array.isArray(raw);
}

function finite(raw: unknown): number | null {
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

/**
 * Which P&L curves the one Strategy Lab chart draws.
 * Pure and instant: the page never refetches when Chris changes mode, dates, or structures.
 */

import {
  crossoverText,
  type ExpiryCrossover,
  type HorizonView,
  type LabEvaluation,
  type PricedStructure,
} from "@/lib/strategyLab/lab";
import { LAB_PALETTE } from "@/lib/strategyLab/palette";

export const CHART_MODES = [
  { id: "waterfall", label: "Waterfall" },
  { id: "quarters", label: "Quarters" },
  { id: "expiry", label: "At expiry" },
  { id: "today", label: "Today" },
  { id: "span", label: "Today + date + expiry" },
  { id: "dateOverlay", label: "All at one date" },
  { id: "custom", label: "Custom" },
] as const;

export type ChartMode = (typeof CHART_MODES)[number]["id"];

export type ChartSelection = {
  mode: ChartMode;
  structureIds: readonly string[];
  horizonIds: readonly string[];
  /** Structure that owns the waterfall rainbow. Last one turned on. */
  focusStructureId: string | null;
  /** Middle date for "today + date + expiry", and the date for "all at one date". */
  focusHorizonId: string | null;
};

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

export function shortHorizon(label: string): string {
  return label.split(" · ")[0] ?? label;
}

/** t = 0 is today (cyan). t = 1 is expiry (magenta). Lightness stays high on near-black. */
export function rainbowColor(t: number): string {
  const clamped = Math.min(1, Math.max(0, t));
  const hue = ((188 - clamped * 228) % 360 + 360) % 360;
  return hslToHex(hue, 0.92, 0.64);
}

export function initialChartSelection(evaluation: LabEvaluation): ChartSelection {
  const structures = pricedStructures(evaluation).map((row) => row.spec.id);
  const horizons = [...evaluation.horizons].sort(byDate);
  const middle = horizons.find((horizon) => !isToday(evaluation, horizon) && !horizon.settlement);
  return {
    mode: "waterfall",
    structureIds: structures,
    horizonIds: horizons.map((horizon) => horizon.id),
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

export function toggleHorizon(selection: ChartSelection, id: string): ChartSelection {
  const horizonIds = selection.horizonIds.includes(id)
    ? selection.horizonIds.filter((item) => item !== id)
    : [...selection.horizonIds, id];
  return { ...selection, horizonIds };
}

export function setHorizons(selection: ChartSelection, ids: readonly string[]): ChartSelection {
  return { ...selection, horizonIds: [...ids] };
}

export function setChartMode(selection: ChartSelection, mode: ChartMode): ChartSelection {
  return { ...selection, mode };
}

export function setFocusHorizon(selection: ChartSelection, id: string): ChartSelection {
  return { ...selection, focusHorizonId: id };
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

export function visibleCurves(evaluation: LabEvaluation, selection: ChartSelection): CurveView[] {
  const structures = selectedStructures(evaluation, selection);
  if (structures.length === 0) return [];
  const focus = structures.find((row) => row.spec.id === selection.focusStructureId) ?? structures[0]!;
  const rainbow = structures.length === 1;

  switch (selection.mode) {
    case "waterfall": {
      const curves = paint(focus, structureHorizons(evaluation, focus), "rainbow");
      for (const row of structures) {
        if (row.spec.id === focus.spec.id) continue;
        const horizons = structureHorizons(evaluation, row);
        const expiry = horizons.find((horizon) => horizon.settlement) ?? horizons[horizons.length - 1];
        if (!expiry) continue;
        const [curve] = paint(row, [expiry], "palette");
        if (!curve) continue;
        curves.push({ ...curve, name: `${row.spec.label} · expiry`, dash: "8 4", width: 3.5 });
      }
      return curves;
    }
    case "expiry":
      return structures.flatMap((row) => paint(row, structureHorizons(evaluation, row).filter((horizon) => horizon.settlement), "palette"));
    case "today":
      return structures.flatMap((row) =>
        paint(row, structureHorizons(evaluation, row).filter((horizon) => isToday(evaluation, horizon)), "palette"),
      );
    case "quarters":
    case "custom":
      return structures.flatMap((row) => {
        const chosen = structureHorizons(evaluation, row).filter((horizon) => selection.horizonIds.includes(horizon.id));
        return paint(row, chosen, rainbow ? "rainbow" : "palette");
      });
    case "span":
      return structures.flatMap((row) => paint(row, spanHorizons(evaluation, row, selection.focusHorizonId), rainbow ? "rainbow" : "palette"));
    case "dateOverlay":
      return structures.flatMap((row) => {
        const horizons = structureHorizons(evaluation, row);
        const chosen = horizons.find((horizon) => horizon.id === selection.focusHorizonId) ?? horizons[0];
        return chosen ? paint(row, [chosen], "palette") : [];
      });
    default:
      return [];
  }
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

function paint(row: PricedStructure, horizons: readonly HorizonView[], kind: "rainbow" | "palette"): CurveView[] {
  return horizons.map((horizon, index) => {
    const look = lookOf(row, horizon, index, horizons.length, kind);
    const many = horizons.length > 1 || kind === "rainbow";
    return {
      key: `${row.spec.id}@@${horizon.id}`,
      structureId: row.spec.id,
      horizonId: horizon.id,
      name: many ? `${row.spec.label} · ${shortHorizon(horizon.label)}` : row.spec.label,
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
  const color = LAB_PALETTE.series[row.spec.slot] ?? LAB_PALETTE.series[0];
  if (total <= 1) return { color, width: horizon.settlement ? 4 : 3.5 };
  if (horizon.settlement) return { color, width: 4 };
  return { color, width: 2.75, dash: DATE_DASH[index % DATE_DASH.length] };
}

function spanHorizons(evaluation: LabEvaluation, row: PricedStructure, focusHorizonId: string | null): HorizonView[] {
  const horizons = structureHorizons(evaluation, row);
  const today = horizons.find((horizon) => isToday(evaluation, horizon));
  const expiry = horizons.find((horizon) => horizon.settlement);
  const mid =
    horizons.find((horizon) => horizon.id === focusHorizonId && !horizon.settlement && !isToday(evaluation, horizon)) ??
    horizons.find((horizon) => !horizon.settlement && !isToday(evaluation, horizon));
  const picked = [today, mid, expiry].filter((horizon): horizon is HorizonView => horizon != null);
  return picked.filter((horizon, index) => picked.findIndex((item) => item.id === horizon.id) === index);
}

function pricedStructures(evaluation: LabEvaluation): PricedStructure[] {
  return evaluation.structures.filter((row): row is PricedStructure => row.status === "priced" && row.curves.length > 0);
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

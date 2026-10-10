import {
  addCalendarDays,
  addCalendarMonths,
  calendarDaysBetween,
  formatExpiryLabel,
  listedStrikes,
  nearestExpiry,
  nearestStrike,
  type IsoDate,
  type OptionChain,
  type OptionRight,
} from "@/lib/optionChain/chain";
import { formatInt, formatUsd2 } from "@/lib/format";
import {
  entryDollars,
  expiryPnl,
  expiryRisk,
  markAt,
  netFromLegs,
  packageGreeks,
  priceLegs,
  type Assumptions,
  type ExpiryRisk,
  type PricedLeg,
} from "@/lib/strategyLab/internal/pricing";

export type { Assumptions };
import { resolveTemplate, TEMPLATE_CATALOG, type TemplateRequest } from "@/lib/strategyLab/internal/templates";
import {
  basisMetric,
  bestWhenLine,
  crossoverText,
  describeSpotCallout,
  describeZone,
  solveExpiryZones,
  solveSampledCrossovers,
  zoneContaining,
  zoneOutcome,
  type ExpiryCrossover,
  type ExpiryZone,
  type ZoneSeries,
} from "@/lib/strategyLab/internal/zones";

export { basisMetric, bestWhenLine, crossoverText, describeSpotCallout, describeZone, zoneContaining, zoneOutcome };
export type { ExpiryCrossover, ExpiryZone };

export { TEMPLATE_CATALOG };
export {
  deltaHighlights,
  formatModelDelta,
  highlightFor,
  modelStrike,
  modelStrikeDelta,
  nearestDeltaStrike,
  strikeChoiceLabel,
  strikeDeltas,
  structureDeltaSummary,
} from "@/lib/strategyLab/strikeDelta";
export type { TemplateRequest };

export const LAB_LIMITS = { structures: 4, horizons: 24, legs: 6 } as const;
export const STRUCTURE_SLOTS = [0, 1, 2, 3] as const;
export type StructureSlot = (typeof STRUCTURE_SLOTS)[number];

export const DEFAULT_RATE = 0.04;

export type EntryBasis = { readonly kind: "mid" } | { readonly kind: "natural" } | { readonly kind: "limit"; readonly netPerShare: number };

export type LegSpec = {
  readonly right: OptionRight;
  readonly strike: number;
  readonly ratio: number;
  readonly ivOverride: number | null;
};

export type StructureSpec = {
  readonly id: string;
  readonly label: string;
  readonly expiry: IsoDate;
  readonly snappedFrom: IsoDate | null;
  readonly legs: readonly LegSpec[];
  readonly entry: EntryBasis;
  readonly capitalOverride: number | null;
  readonly slot: StructureSlot;
  readonly origin: { readonly request: TemplateRequest; readonly tracking: boolean } | null;
  readonly resolveError: string | null;
};

export type Basis =
  | { readonly kind: "perPackage" }
  | { readonly kind: "equalCapital"; readonly capital: number; readonly units: "whole" | "fractional" }
  /** Capital equals one package of the most expensive structure. Other structures scale in fractional packages. */
  | { readonly kind: "matchExpensive" };

export type HorizonSpec =
  | { readonly kind: "entry" }
  | { readonly kind: "date"; readonly date: IsoDate }
  | { readonly kind: "monthsFromEntry"; readonly months: number }
  | { readonly kind: "fractionToAnchor"; readonly fraction: number }
  | { readonly kind: "anchorExpiry" }
  /** Today, then every three calendar months, through the earliest expiry. */
  | { readonly kind: "quartersToAnchor" };

export type SpotWindow =
  | { readonly kind: "fit" }
  | { readonly kind: "manual"; readonly min: number; readonly max: number };

export type LabScenario = {
  readonly symbol: string;
  readonly assumptions: Assumptions;
  readonly basis: Basis;
  readonly horizons: readonly HorizonSpec[];
  readonly structures: readonly StructureSpec[];
  readonly window: SpotWindow;
  readonly showStock: boolean;
  /** When true, the stock line joins the expiry ranking. The chart line stays on `showStock`. */
  readonly compareStock: boolean;
  readonly seq: number;
  readonly createdFrom: { readonly spot: number; readonly tradeDate: IsoDate };
};

export type LabEdit =
  | { readonly kind: "setAssumptions"; readonly patch: Partial<Assumptions> }
  | { readonly kind: "setBasis"; readonly basis: Basis }
  | { readonly kind: "setHorizons"; readonly horizons: readonly HorizonSpec[] }
  | { readonly kind: "setWindow"; readonly window: SpotWindow }
  | { readonly kind: "setShowStock"; readonly show: boolean }
  | { readonly kind: "setCompareStock"; readonly compare: boolean }
  | {
      readonly kind: "addStructure";
      readonly expiry: IsoDate;
      readonly request: TemplateRequest;
      readonly entry?: EntryBasis;
      readonly label?: string;
    }
  | { readonly kind: "removeStructure"; readonly id: string }
  | { readonly kind: "setExpiry"; readonly id: string; readonly expiry: IsoDate }
  | { readonly kind: "setStrike"; readonly id: string; readonly legIndex: number; readonly strike: number }
  | { readonly kind: "stepStrike"; readonly id: string; readonly legIndex: number; readonly steps: number }
  | { readonly kind: "setEntry"; readonly id: string; readonly entry: EntryBasis }
  | { readonly kind: "setIvOverride"; readonly id: string; readonly legIndex: number; readonly iv: number | null }
  | { readonly kind: "setCapitalOverride"; readonly id: string; readonly dollars: number | null }
  | { readonly kind: "addLeg"; readonly id: string; readonly right: OptionRight; readonly strike: number; readonly ratio: number }
  | { readonly kind: "removeLeg"; readonly id: string; readonly legIndex: number }
  | { readonly kind: "setLabel"; readonly id: string; readonly label: string }
  | { readonly kind: "retarget"; readonly id: string };

export type CurvePoint = { readonly spot: number; readonly pnl: number };

export type Sizing =
  | {
      readonly status: "perPackage";
      readonly packages: 1;
      readonly invested: number;
      readonly idleCash: 0;
      readonly leverage: number | null;
      readonly pnlPerPercent: number | null;
    }
  | {
      readonly status: "sized";
      readonly packages: number;
      readonly invested: number;
      readonly idleCash: number;
      readonly leverage: number | null;
      readonly pnlPerPercent: number | null;
    }
  | { readonly status: "needsCapitalOverride" };

/** Dollar amount and structure the match-the-most-expensive basis locked onto. */
export type MatchedBasis = { readonly capital: number; readonly label: string };

export type HorizonView = {
  readonly id: string;
  readonly date: IsoDate;
  readonly label: string;
  readonly shared: boolean;
  readonly settlement: boolean;
  readonly structureId: string | null;
};

export type ModelCrossover = ExpiryCrossover & { readonly horizonId: string; readonly approximate: true };

export type ExpiryBoard = {
  readonly expiry: IsoDate;
  readonly metric: string;
  readonly exact: boolean;
  readonly note: string | null;
  readonly structureIds: readonly string[];
  readonly crossovers: readonly ExpiryCrossover[];
  readonly zones: readonly ExpiryZone[];
};

export type LabIssue = {
  readonly severity: "info" | "warn" | "block";
  readonly structureId: string | null;
  readonly code: string;
  readonly message: string;
};

export type PricedStructure = {
  readonly status: "priced";
  readonly spec: StructureSpec;
  readonly legs: readonly PricedLeg[];
  readonly days: number;
  readonly ownHalfway: IsoDate;
  readonly midPerShare: number | null;
  readonly naturalPerShare: number | null;
  readonly usedPerShare: number;
  readonly debit: number;
  readonly risk: ExpiryRisk;
  readonly greeks: { readonly delta: number; readonly gamma: number; readonly theta: number; readonly vega: number } | null;
  readonly sizing: Sizing;
  readonly curves: readonly { readonly horizonId: string; readonly points: readonly CurvePoint[] }[];
};

export type StructureEval = PricedStructure | { readonly status: "blocked"; readonly spec: StructureSpec; readonly reason: string };

export type LabEvaluation = {
  readonly entryDate: IsoDate;
  readonly spot: number;
  readonly anchorExpiry: IsoDate | null;
  readonly axis: readonly number[];
  readonly horizons: readonly HorizonView[];
  readonly structures: readonly StructureEval[];
  readonly stock: readonly { readonly horizonId: string; readonly points: readonly CurvePoint[] }[];
  readonly issues: readonly LabIssue[];
  readonly basis: Basis;
  readonly match: MatchedBasis | null;
  readonly metric: string;
  readonly expiryBoards: readonly ExpiryBoard[];
  readonly modelCrossovers: readonly ModelCrossover[];
  /** Spot axis shared by every panel. `source` is fit unless Chris typed a min and max. */
  readonly spotWindow: {
    readonly min: number;
    readonly max: number;
    readonly fittedMin: number;
    readonly fittedMax: number;
    readonly source: "fit" | "manual";
  };
};

const LETTERS = ["A", "B", "C", "D"] as const;

export function createLab(chain: OptionChain): LabScenario {
  return {
    symbol: chain.symbol,
    assumptions: { rate: DEFAULT_RATE, dividendYield: 0, ivSource: "mid" },
    basis: { kind: "matchExpensive" },
    horizons: [{ kind: "quartersToAnchor" }],
    structures: [],
    window: { kind: "fit" },
    showStock: true,
    compareStock: false,
    seq: 1,
    createdFrom: { spot: chain.spot, tradeDate: chain.tradeDate },
  };
}

function mapStructure(lab: LabScenario, id: string, fn: (s: StructureSpec) => StructureSpec): LabScenario {
  return { ...lab, structures: lab.structures.map((s) => (s.id === id ? fn(s) : s)) };
}

function withLegs(chain: OptionChain, lab: LabScenario, spec: StructureSpec, request: TemplateRequest, expiry: IsoDate, tracking: boolean): StructureSpec {
  const resolved = resolveTemplate(request, chain, expiry, lab.assumptions);
  if ("error" in resolved) {
    return { ...spec, expiry, legs: [], origin: { request, tracking }, resolveError: resolved.error };
  }
  return {
    ...spec,
    expiry,
    legs: resolved.legs.map((leg) => ({ ...leg, ivOverride: null })),
    origin: { request, tracking },
    resolveError: null,
  };
}

function applyOne(lab: LabScenario, edit: LabEdit, chain: OptionChain): LabScenario {
  switch (edit.kind) {
    case "setAssumptions":
      return { ...lab, assumptions: { ...lab.assumptions, ...edit.patch } };
    case "setBasis":
      return { ...lab, basis: edit.basis };
    case "setHorizons":
      return { ...lab, horizons: edit.horizons.slice(0, LAB_LIMITS.horizons) };
    case "setWindow": {
      const next = edit.window;
      if (next.kind === "manual" && !(next.max > next.min && Number.isFinite(next.min) && Number.isFinite(next.max))) return lab;
      return { ...lab, window: next };
    }
    case "setShowStock":
      return { ...lab, showStock: edit.show };
    case "setCompareStock":
      return { ...lab, compareStock: edit.compare };
    case "addStructure": {
      if (lab.structures.length >= LAB_LIMITS.structures) return lab;
      const used = new Set(lab.structures.map((s) => s.slot));
      const slot = STRUCTURE_SLOTS.find((s) => !used.has(s));
      if (slot == null) return lab;
      const listed = nearestExpiry(chain, edit.expiry);
      if (!listed) return lab;
      const id = `s${lab.seq}`;
      const blank: StructureSpec = {
        id,
        label: edit.label?.trim() || LETTERS[slot],
        expiry: listed,
        snappedFrom: listed === edit.expiry ? null : edit.expiry,
        legs: [],
        entry: edit.entry ?? { kind: "mid" },
        capitalOverride: null,
        slot,
        origin: null,
        resolveError: null,
      };
      const spec = withLegs(chain, lab, blank, edit.request, listed, true);
      return { ...lab, seq: lab.seq + 1, structures: [...lab.structures, spec] };
    }
    case "removeStructure":
      return { ...lab, structures: lab.structures.filter((s) => s.id !== edit.id) };
    case "setExpiry":
      return mapStructure(lab, edit.id, (spec) => {
        const listed = nearestExpiry(chain, edit.expiry) ?? spec.expiry;
        const snappedFrom = listed === edit.expiry ? null : edit.expiry;
        if (spec.origin?.tracking) {
          return { ...withLegs(chain, lab, spec, spec.origin.request, listed, true), snappedFrom };
        }
        return {
          ...spec,
          expiry: listed,
          snappedFrom,
          legs: spec.legs.map((leg) => {
            const snapped = nearestStrike(listedStrikes(chain, listed, leg.right), leg.strike);
            return snapped == null ? leg : { ...leg, strike: snapped };
          }),
        };
      });
    case "setStrike":
      return mapStructure(lab, edit.id, (spec) => ({
        ...spec,
        origin: spec.origin ? { ...spec.origin, tracking: false } : null,
        legs: spec.legs.map((leg, i) => {
          if (i !== edit.legIndex) return leg;
          const snapped = nearestStrike(listedStrikes(chain, spec.expiry, leg.right), edit.strike);
          return snapped == null ? leg : { ...leg, strike: snapped };
        }),
      }));
    case "stepStrike":
      return mapStructure(lab, edit.id, (spec) => ({
        ...spec,
        origin: spec.origin ? { ...spec.origin, tracking: false } : null,
        legs: spec.legs.map((leg, i) => {
          if (i !== edit.legIndex) return leg;
          const strikes = listedStrikes(chain, spec.expiry, leg.right);
          const idx = strikes.findIndex((s) => Math.round(s * 1000) === Math.round(leg.strike * 1000));
          const next = strikes[idx + edit.steps];
          return next == null ? leg : { ...leg, strike: next };
        }),
      }));
    case "setEntry":
      return mapStructure(lab, edit.id, (spec) => ({ ...spec, entry: edit.entry }));
    case "setIvOverride":
      return mapStructure(lab, edit.id, (spec) => ({
        ...spec,
        legs: spec.legs.map((leg, i) => (i === edit.legIndex ? { ...leg, ivOverride: edit.iv } : leg)),
      }));
    case "setCapitalOverride": {
      const dollars = edit.dollars;
      if (dollars != null && !(Number.isFinite(dollars) && dollars > 0)) return lab;
      return mapStructure(lab, edit.id, (spec) => ({ ...spec, capitalOverride: dollars }));
    }
    case "addLeg": {
      if (!Number.isInteger(edit.ratio) || edit.ratio === 0) return lab;
      return mapStructure(lab, edit.id, (spec) => {
        if (spec.legs.length >= LAB_LIMITS.legs) return spec;
        const snapped = nearestStrike(listedStrikes(chain, spec.expiry, edit.right), edit.strike);
        if (snapped == null) return spec;
        return {
          ...spec,
          origin: spec.origin ? { ...spec.origin, tracking: false } : null,
          resolveError: null,
          legs: [...spec.legs, { right: edit.right, strike: snapped, ratio: edit.ratio, ivOverride: null }],
        };
      });
    }
    case "removeLeg": {
      const spec = lab.structures.find((item) => item.id === edit.id);
      if (!spec || edit.legIndex < 0 || edit.legIndex >= spec.legs.length) return lab;
      if (spec.legs.length <= 1) return { ...lab, structures: lab.structures.filter((item) => item.id !== edit.id) };
      return mapStructure(lab, edit.id, (current) => ({
        ...current,
        origin: current.origin ? { ...current.origin, tracking: false } : null,
        legs: current.legs.filter((_, index) => index !== edit.legIndex),
      }));
    }
    case "setLabel":
      return mapStructure(lab, edit.id, (spec) => ({ ...spec, label: edit.label }));
    case "retarget":
      return mapStructure(lab, edit.id, (spec) => {
        if (!spec.origin) return spec;
        return withLegs(chain, lab, spec, spec.origin.request, spec.expiry, true);
      });
    default:
      return lab;
  }
}

export function editLab(lab: LabScenario, edit: LabEdit | readonly LabEdit[], chain: OptionChain): LabScenario {
  const edits = Array.isArray(edit) ? edit : [edit];
  return edits.reduce((current, one) => applyOne(current, one, chain), lab);
}

function horizonViews(lab: LabScenario, chain: OptionChain): { horizons: HorizonView[]; anchor: IsoDate | null } {
  const expiries = lab.structures.map((s) => s.expiry);
  const anchor = expiries.length ? expiries.reduce((a, b) => (a < b ? a : b)) : null;
  const allSame = expiries.length > 0 && expiries.every((e) => e === anchor);
  const horizons: HorizonView[] = [];
  for (const spec of lab.horizons) {
    if (spec.kind === "entry") {
      horizons.push({
        id: `entry:${chain.tradeDate}`,
        date: chain.tradeDate,
        label: `Shared date · ${formatExpiryLabel(chain.tradeDate)}`,
        shared: true,
        settlement: false,
        structureId: null,
      });
      continue;
    }
    if (spec.kind === "date") {
      horizons.push({
        id: `date:${spec.date}`,
        date: spec.date,
        label: `Shared date · ${formatExpiryLabel(spec.date)}`,
        shared: true,
        settlement: false,
        structureId: null,
      });
      continue;
    }
    if (spec.kind === "monthsFromEntry") {
      const date = addCalendarMonths(chain.tradeDate, spec.months);
      horizons.push({
        id: `m:${spec.months}:${date}`,
        date,
        label: `Shared date · +${spec.months} mo · ${formatExpiryLabel(date)}`,
        shared: true,
        settlement: false,
        structureId: null,
      });
      continue;
    }
    if (spec.kind === "quartersToAnchor") {
      if (!anchor) continue;
      const steps: { months: number; date: IsoDate }[] = [];
      for (let step = 0; step < 40; step++) {
        const months = step * 3;
        const date = months === 0 ? chain.tradeDate : addCalendarMonths(chain.tradeDate, months);
        if (months > 0 && date >= anchor) break;
        steps.push({ months, date });
      }
      for (const step of steps) {
        const label =
          step.months === 0
            ? `Today · ${formatExpiryLabel(step.date)}`
            : `+${step.months} mo · ${formatExpiryLabel(step.date)}`;
        horizons.push({
          id: `q:${step.months}:${step.date}`,
          date: step.date,
          label,
          shared: true,
          settlement: false,
          structureId: null,
        });
      }
      if (allSame) {
        horizons.push({
          id: `q:expiry:${anchor}`,
          date: anchor,
          label: `Expiry · ${formatExpiryLabel(anchor)}`,
          shared: true,
          settlement: true,
          structureId: null,
        });
      } else {
        for (const structure of lab.structures) {
          horizons.push({
            id: `q:expiry:${structure.id}:${structure.expiry}`,
            date: structure.expiry,
            label: `Expiry · ${structure.label} · ${formatExpiryLabel(structure.expiry)}`,
            shared: false,
            settlement: true,
            structureId: structure.id,
          });
        }
      }
      continue;
    }
    if (!anchor) continue;
    const pushOwn = (structure: StructureSpec, date: IsoDate, label: string) => {
      horizons.push({
        id: `${spec.kind}:${structure.id}:${date}`,
        date,
        label,
        shared: false,
        settlement: spec.kind === "anchorExpiry",
        structureId: structure.id,
      });
    };
    if (allSame) {
      const days = calendarDaysBetween(chain.tradeDate, anchor);
      const date = spec.kind === "anchorExpiry" ? anchor : addCalendarDays(chain.tradeDate, Math.floor(days * spec.fraction));
      const label =
        spec.kind === "anchorExpiry"
          ? `Expiry · ${formatExpiryLabel(date)}`
          : `Halfway to ${formatExpiryLabel(anchor)} · ${formatExpiryLabel(date)}`;
      horizons.push({
        id: `${spec.kind}:${date}`,
        date,
        label,
        shared: true,
        settlement: spec.kind === "anchorExpiry",
        structureId: null,
      });
    } else {
      for (const structure of lab.structures) {
        const days = calendarDaysBetween(chain.tradeDate, structure.expiry);
        const date =
          spec.kind === "anchorExpiry"
            ? structure.expiry
            : addCalendarDays(chain.tradeDate, Math.floor(days * spec.fraction));
        const label =
          spec.kind === "anchorExpiry"
            ? `Expiry · ${structure.label} · ${formatExpiryLabel(structure.expiry)}`
            : `Halfway · ${structure.label} · ${formatExpiryLabel(date)} (own expiry ${formatExpiryLabel(structure.expiry)})`;
        pushOwn(structure, date, label);
      }
    }
  }
  return { horizons, anchor };
}

const WINDOW_PAD = 0.08;

/** Pad the extreme spots so a crossover sits inside the window, not on the frame. */
export function fitSpotWindow(spots: readonly number[]): { min: number; max: number } {
  const finite = spots.filter((n) => Number.isFinite(n) && n > 0);
  if (finite.length === 0) return { min: 1, max: 2 };
  const rawLo = Math.min(...finite);
  const rawHi = Math.max(...finite);
  const span = Math.max(rawHi - rawLo, rawHi * 0.05, 1);
  const pad = span * WINDOW_PAD;
  const min = Math.max(0.01, rawLo - pad);
  const max = rawHi + pad;
  return { min, max: max > min ? max : min + 1 };
}

function buildAxis(lo: number, hi: number, extras: number[]): number[] {
  const n = 241;
  const spots = new Set<number>();
  for (let i = 0; i < n; i++) spots.add(lo + ((hi - lo) * i) / (n - 1));
  for (const s of extras) if (s >= lo && s <= hi) spots.add(s);
  return [...spots].sort((a, b) => a - b);
}

function axisCovering(
  fitted: { min: number; max: number },
  window: SpotWindow,
  extras: number[],
): number[] {
  const span = Math.max(fitted.max - fitted.min, 1);
  let lo = fitted.min - span * 0.15;
  let hi = fitted.max + span * 0.15;
  if (window.kind === "manual" && window.max > window.min) {
    lo = Math.min(lo, window.min);
    hi = Math.max(hi, window.max);
  }
  if (!(hi > lo)) hi = lo + 1;
  return buildAxis(Math.max(0.01, lo), hi, extras);
}

/** Whole dollars when the amount is already whole, otherwise cents. */
export function labDollars(amount: number): string {
  return Math.abs(amount - Math.round(amount)) < 0.005 ? `$${formatInt(Math.round(amount))}` : formatUsd2(amount);
}

/** A whole-contract structure whose package costs more than the capital. P&L would otherwise be a flat $0. */
export function zeroPackageNotice(label: string, capital: number, packageCost: number | null): string {
  const cost = packageCost != null && packageCost > 0 ? labDollars(packageCost) : "more than the capital";
  return `${label}: 0 packages on ${labDollars(capital)} (package costs ${cost}); raise capital or use fractional units`;
}

export function packageCostOf(row: { spec: { capitalOverride: number | null }; risk: { maxLoss: number | "unbounded" } }): number | null {
  if (row.spec.capitalOverride != null && row.spec.capitalOverride > 0) return row.spec.capitalOverride;
  return typeof row.risk.maxLoss === "number" && row.risk.maxLoss > 0 ? row.risk.maxLoss : null;
}

function attachCurves(
  priced: readonly PricedStructure[],
  horizons: readonly HorizonView[],
  chain: OptionChain,
  lab: LabScenario,
  axis: readonly number[],
  issues: LabIssue[],
  warnMissingIv: boolean,
): PricedStructure[] {
  return priced.map((structure) => {
    if (structure.sizing.status === "needsCapitalOverride") return structure;
    const packages = structure.sizing.packages;
    const curves = horizons
      .filter((h) => h.structureId == null || h.structureId === structure.spec.id)
      .map((h) => {
        const settled = calendarDaysBetween(h.date, structure.spec.expiry) <= 0;
        if (!settled && structure.legs.some((leg) => leg.iv == null)) return null;
        const points = axis.map((spot) => {
          const value = markAt(chain, structure.spec.expiry, structure.legs, lab.assumptions, spot, h.date);
          const per = (value ?? 0) - structure.debit;
          return { spot, pnl: per * packages };
        });
        return { horizonId: h.id, points };
      })
      .filter((c): c is { horizonId: string; points: CurvePoint[] } => c != null);
    if (
      warnMissingIv &&
      structure.legs.some((leg) => leg.iv == null) &&
      !structure.legs.every((leg) => leg.iv != null || horizons.every((h) => calendarDaysBetween(h.date, structure.spec.expiry) <= 0))
    ) {
      issues.push({
        severity: "warn",
        structureId: structure.spec.id,
        code: "iv-missing",
        message: "A leg has no IV, so dates before expiry have no curve.",
      });
    }
    return { ...structure, curves };
  });
}

function stockSeries(
  lab: LabScenario,
  horizons: readonly HorizonView[],
  axis: readonly number[],
  chain: OptionChain,
  capital: number,
): { horizonId: string; points: CurvePoint[] }[] {
  if (!lab.showStock) return [];
  return horizons
    .filter((h) => h.shared)
    .map((h) => ({
      horizonId: h.id,
      points: axis.map((spot) => ({ spot, pnl: ((spot - chain.spot) / chain.spot) * capital })),
    }));
}

/**
 * Entry leverage: today's share-equivalent exposure (package delta × packages × spot)
 * divided by dollars invested. Dollars invested is the net debit of the packages bought.
 * Idle cash is not in the denominator. The tile headline uses the short-strike-at-expiry basis;
 * this field is the "at entry" line.
 */
function exposureStats(packages: number, invested: number, delta: number | null, spot: number): { leverage: number | null; pnlPerPercent: number | null } {
  if (delta == null) return { leverage: null, pnlPerPercent: null };
  const exposure = delta * packages * spot;
  return {
    leverage: invested > 0 ? exposure / invested : null,
    pnlPerPercent: exposure * 0.01,
  };
}

/**
 * Cash to open one package. A positive debit is that cash. A credit uses defined max loss.
 * A typed dollars-at-risk number wins.
 */
export function packageOutlay(debit: number, maxLoss: number | "unbounded", override: number | null): number | null {
  if (override != null && override > 0) return override;
  if (debit > 0) return debit;
  if (typeof maxLoss === "number" && maxLoss > 0) return maxLoss;
  return null;
}

function sizeOf(
  basis: Basis,
  maxLoss: number | "unbounded",
  override: number | null,
  delta: number | null,
  spot: number,
  matched: MatchedBasis | null,
  debit: number,
): Sizing {
  if (basis.kind === "matchExpensive") {
    const cost = packageOutlay(debit, maxLoss, override);
    if (matched == null || cost == null || !(cost > 0)) return { status: "needsCapitalOverride" };
    const packages = matched.capital / cost;
    return { status: "sized", packages, invested: matched.capital, idleCash: 0, ...exposureStats(packages, matched.capital, delta, spot) };
  }
  const capitalPer = override ?? (typeof maxLoss === "number" ? maxLoss : null);
  if (basis.kind === "perPackage") {
    const invested = capitalPer ?? 0;
    return { status: "perPackage", packages: 1, invested, idleCash: 0, ...exposureStats(1, invested, delta, spot) };
  }
  if (capitalPer == null || !(capitalPer > 0)) return { status: "needsCapitalOverride" };
  if (basis.units === "whole") {
    const packages = Math.floor(basis.capital / capitalPer);
    const invested = packages * capitalPer;
    return { status: "sized", packages, invested, idleCash: basis.capital - invested, ...exposureStats(packages, invested, delta, spot) };
  }
  const packages = basis.capital / capitalPer;
  return { status: "sized", packages, invested: basis.capital, idleCash: 0, ...exposureStats(packages, basis.capital, delta, spot) };
}

function matchedBasis(basis: Basis, rows: readonly PricedStructure[]): MatchedBasis | null {
  if (basis.kind !== "matchExpensive") return null;
  let best: { capital: number; label: string } | null = null;
  for (const row of rows) {
    const cost = packageOutlay(row.debit, row.risk.maxLoss, row.spec.capitalOverride);
    if (cost == null || !(cost > 0)) continue;
    if (best == null || cost > best.capital) best = { capital: cost, label: row.spec.label };
  }
  return best;
}

export function evaluateLab(lab: LabScenario, chain: OptionChain): LabEvaluation {
  const issues: LabIssue[] = [];
  const { horizons, anchor } = horizonViews(lab, chain);
  const priced: PricedStructure[] = [];
  const blocked: StructureEval[] = [];
  const axisExtras: number[] = [];

  for (const spec of lab.structures) {
    if (spec.snappedFrom) {
      issues.push({
        severity: "info",
        structureId: spec.id,
        code: "snapped-expiry",
        message: `${formatExpiryLabel(spec.snappedFrom)} is not listed. Using ${formatExpiryLabel(spec.expiry)}.`,
      });
    }
    if (spec.resolveError || spec.legs.length === 0) {
      blocked.push({ status: "blocked", spec, reason: spec.resolveError ?? "No legs." });
      issues.push({ severity: "block", structureId: spec.id, code: "unresolved", message: spec.resolveError ?? "No legs." });
      continue;
    }
    const quoted = priceLegs(chain, spec.expiry, spec.legs, lab.assumptions);
    if ("error" in quoted) {
      blocked.push({ status: "blocked", spec, reason: quoted.error });
      issues.push({ severity: "block", structureId: spec.id, code: "no-quote", message: quoted.error });
      continue;
    }
    if (quoted.ivFallback) {
      issues.push({
        severity: "warn",
        structureId: spec.id,
        code: "iv-fallback",
        message: "A leg used the other IV source because the selected one did not solve.",
      });
    }
    const midPerShare = netFromLegs(quoted.legs, "mid");
    const naturalPerShare = netFromLegs(quoted.legs, "natural");
    if (spec.entry.kind === "natural" && naturalPerShare == null) {
      issues.push({
        severity: "warn",
        structureId: spec.id,
        code: "natural-missing",
        message: "Natural price needs a bid on short legs and an ask on long legs.",
      });
    }
    const usedPerShare =
      spec.entry.kind === "limit" ? spec.entry.netPerShare : spec.entry.kind === "natural" ? naturalPerShare : midPerShare;
    if (usedPerShare == null) {
      blocked.push({ status: "blocked", spec, reason: "No entry price." });
      issues.push({ severity: "block", structureId: spec.id, code: "no-entry", message: "No entry price." });
      continue;
    }
    const debit = entryDollars(usedPerShare);
    const risk = expiryRisk(quoted.legs, debit, chain.spot);
    const greeks = packageGreeks(chain, spec.expiry, quoted.legs, lab.assumptions);
    for (const b of risk.breakevens) axisExtras.push(b);
    for (const leg of quoted.legs) axisExtras.push(leg.strike);
    const days = calendarDaysBetween(chain.tradeDate, spec.expiry);
    priced.push({
      status: "priced",
      spec,
      legs: quoted.legs,
      days,
      ownHalfway: addCalendarDays(chain.tradeDate, Math.floor(days / 2)),
      midPerShare,
      naturalPerShare,
      usedPerShare,
      debit,
      risk,
      greeks,
      sizing: { status: "needsCapitalOverride" },
      curves: [],
    });
  }

  const match = matchedBasis(lab.basis, priced);
  const sized = priced.map((row) => {
    const sizing = sizeOf(lab.basis, row.risk.maxLoss, row.spec.capitalOverride, row.greeks?.delta ?? null, chain.spot, match, row.debit);
    if (sizing.status === "needsCapitalOverride") {
      issues.push({
        severity: "warn",
        structureId: row.spec.id,
        code: "needs-capital",
        message: "Undefined risk. Equal-dollar sizing waits for a typed dollars-at-risk number.",
      });
    }
    if (sizing.status === "sized" && sizing.packages === 0 && lab.basis.kind === "equalCapital") {
      const cost = row.spec.capitalOverride ?? (typeof row.risk.maxLoss === "number" ? row.risk.maxLoss : null);
      issues.push({
        severity: "warn",
        structureId: row.spec.id,
        code: "below-one-package",
        message: zeroPackageNotice(row.spec.label, lab.basis.capital, cost),
      });
    }
    return { ...row, sizing };
  });

  const createdRatio = chain.spot / lab.createdFrom.spot;
  const whole = Math.round(createdRatio);
  if (whole >= 2 && Math.abs(createdRatio - whole) / whole < 0.04) {
    const missing = lab.structures.some((s) =>
      s.legs.some((leg) => !listedStrikes(chain, s.expiry, leg.right).some((k) => Math.round(k * 1000) === Math.round(leg.strike * 1000))),
    );
    if (missing) {
      issues.push({
        severity: "warn",
        structureId: null,
        code: "possible-corporate-action",
        message: `Spot moved about ${whole}× and a strike is no longer listed. Strikes were not adjusted.`,
      });
    }
  }

  const metric = basisMetric(lab.basis, match);
  const capital = lab.basis.kind === "equalCapital" ? lab.basis.capital : (match?.capital ?? chain.spot * 100);
  const expiryBoards = expiryBoardsOf(sized, metric, lab.compareStock, chain.spot, capital);
  const anchorSpots = [chain.spot, ...axisExtras, ...expiryBoards.flatMap((board) => board.crossovers.map((crossover) => crossover.spot))];
  let fitted = fitSpotWindow(anchorSpots);
  let axis = axisCovering(fitted, lab.window, [chain.spot, ...axisExtras]);
  let withCurves = attachCurves(sized, horizons, chain, lab, axis, issues, true);
  let modelCrossovers = modelCrossoversOf(horizons, withCurves);
  fitted = fitSpotWindow([...anchorSpots, ...modelCrossovers.map((crossover) => crossover.spot)]);
  const manual = lab.window.kind === "manual" && lab.window.max > lab.window.min ? lab.window : null;
  let display = manual ?? fitted;
  const covers = (lo: number, hi: number) => {
    const first = axis[0] ?? lo;
    const last = axis[axis.length - 1] ?? hi;
    return lo >= first - 1e-6 && hi <= last + 1e-6;
  };
  if (!covers(display.min, display.max) || !covers(fitted.min, fitted.max)) {
    const lo = Math.min(display.min, fitted.min, axis[0] ?? display.min);
    const hi = Math.max(display.max, fitted.max, axis[axis.length - 1] ?? display.max);
    axis = buildAxis(lo, hi, [chain.spot, ...axisExtras]);
    withCurves = attachCurves(sized, horizons, chain, lab, axis, issues, false);
    modelCrossovers = modelCrossoversOf(horizons, withCurves);
    fitted = fitSpotWindow([...anchorSpots, ...modelCrossovers.map((crossover) => crossover.spot)]);
    display = manual ?? fitted;
  }

  const stock = stockSeries(lab, horizons, axis, chain, capital);
  const structures: StructureEval[] = [...withCurves, ...blocked].sort((a, b) => a.spec.slot - b.spec.slot);

  return {
    entryDate: chain.tradeDate,
    spot: chain.spot,
    anchorExpiry: anchor,
    axis,
    horizons,
    structures,
    stock,
    issues,
    basis: lab.basis,
    match,
    metric,
    expiryBoards,
    modelCrossovers,
    spotWindow: {
      min: display.min,
      max: display.max,
      fittedMin: fitted.min,
      fittedMax: fitted.max,
      source: manual ? "manual" : "fit",
    },
  };
}

function zoneSeriesOf(row: PricedStructure): ZoneSeries | null {
  if (row.sizing.status === "needsCapitalOverride" || !(row.sizing.packages > 0)) return null;
  const packages = row.sizing.packages;
  const strikes = [...new Set(row.legs.map((leg) => leg.strike))].sort((a, b) => a - b);
  const last = strikes[strikes.length - 1] ?? 0;
  const slope =
    last > 0 ? (expiryPnl(row.legs, row.debit, last + 1) - expiryPnl(row.legs, row.debit, last)) * packages : 0;
  return {
    id: row.spec.id,
    label: row.spec.label,
    pnl: (spot) => expiryPnl(row.legs, row.debit, spot) * packages,
    terminalSlope: slope,
    knots: strikes,
    plateauFrom: Math.abs(slope) < 1e-6 && last > 0 ? last : null,
  };
}

function expiryBoardsOf(
  structures: readonly StructureEval[],
  metric: string,
  compareStock: boolean,
  spot: number,
  capital: number,
): ExpiryBoard[] {
  const groups = new Map<IsoDate, ZoneSeries[]>();
  for (const row of structures) {
    if (row.status !== "priced") continue;
    const series = zoneSeriesOf(row);
    if (!series) continue;
    const list = groups.get(row.spec.expiry) ?? [];
    list.push(series);
    groups.set(row.spec.expiry, list);
  }
  const expiries = [...groups.keys()];
  const stock: ZoneSeries | null =
    compareStock && spot > 0
      ? {
          id: "stock",
          label: "Stock",
          pnl: (price) => ((price - spot) / spot) * capital,
          terminalSlope: capital / spot,
          knots: [],
          plateauFrom: null,
        }
      : null;
  return expiries.sort().map((expiry) => {
    const members = groups.get(expiry) ?? [];
    const series = stock ? [...members, stock] : members;
    const solved = solveExpiryZones(series);
    const alone = members.length < 2;
    const mixed = expiries.length > 1;
    const exact = !alone || !mixed;
    let note: string | null = null;
    if (alone && mixed) note = "Approximate. Zones are exact only for structures that share an expiry.";
    else if (alone) note = "Only structure on this expiry.";
    else if (mixed) note = "Exact for structures that share this expiry. Other expiries are not in this ranking.";
    return {
      expiry,
      metric,
      exact,
      note,
      structureIds: series.map((item) => item.id),
      crossovers: solved.crossovers,
      zones: solved.zones,
    };
  });
}

function modelCrossoversOf(horizons: readonly HorizonView[], structures: readonly StructureEval[]): ModelCrossover[] {
  const out: ModelCrossover[] = [];
  for (const horizon of horizons) {
    if (horizon.settlement) continue;
    const sampled = structures.flatMap((row) => {
      if (row.status !== "priced") return [];
      const curve = row.curves.find((item) => item.horizonId === horizon.id);
      if (!curve) return [];
      return [{ id: row.spec.id, label: row.spec.label, points: curve.points }];
    });
    for (const hit of solveSampledCrossovers(sampled)) {
      out.push({ ...hit, horizonId: horizon.id, approximate: true });
    }
  }
  return out;
}

export function capitalExpiryPnl(row: PricedStructure, spot: number): number | null {
  if (row.sizing.status === "needsCapitalOverride" || !(row.sizing.packages > 0)) return null;
  return expiryPnl(row.legs, row.debit, spot) * row.sizing.packages;
}

export function bestWhenFor(boards: readonly ExpiryBoard[], id: string): string {
  const board = boards.find((item) => item.structureIds.includes(id));
  if (!board) return "never best";
  const line = bestWhenLine(board.zones, id);
  return board.exact ? line : `Approximate. ${line}`;
}

export function expiryPnlAtSpot(
  legs: readonly { right: OptionRight; strike: number; ratio: number }[],
  debit: number,
  spot: number,
): number {
  return expiryPnl(legs, debit, spot);
}

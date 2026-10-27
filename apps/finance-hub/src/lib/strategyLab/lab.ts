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
  stockEntryDollars,
  structurePackageCost,
  type Assumptions,
  type ExpiryRisk,
  type PricedLeg,
} from "@/lib/strategyLab/internal/pricing";

export type { Assumptions };
import { forwardDateSteps, forwardStepId, forwardStepLabel } from "@/lib/strategyLab/dateSteps";
import { daysHeldFromLegs, entryPackageDebit, legMissingBookCost, packageUsesEntryCost } from "@/lib/strategyLab/entryCost";
import { assignLegIds, HELD_LEG_CAP, legCostOf, legEntry, OPTION_QTY_CAP, optionLeg, parityPackageDebit, stockLeg, syntheticShape, type Leg, type LegCost } from "@/lib/strategyLab/legs";
import { structureDisplayNames } from "@/lib/strategyLab/displayNames";
import { MODEL_DIVIDEND_YIELD, MODEL_RATE, underlyingModelIv } from "@/lib/strategyLab/modelAssumptions";
import { catalogRequest, resolveTemplate, TEMPLATE_CATALOG, type TemplateId, type TemplateRequest } from "@/lib/strategyLab/internal/templates";
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

export { catalogRequest, TEMPLATE_CATALOG };
export type { TemplateId };
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

export const LAB_LIMITS = { structures: 12, horizons: 24, legs: 8 } as const;
export type StructureSlot = number;

export const DEFAULT_RATE = 0.04;

export type EntryBasis = { readonly kind: "mid" } | { readonly kind: "natural" } | { readonly kind: "limit"; readonly netPerShare: number };

export type LegSpec = Leg;

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
  /** Book packages name their ticker. Hand-built structures leave this null and use the lab symbol. */
  readonly underlying: string | null;
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
  /** Today, three-month steps, then monthly and weekly steps into the latest expiry. */
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
  | {
      readonly kind: "setLegCost";
      readonly id: string;
      readonly legIndex: number;
      readonly manualPrice: number | null;
      readonly manualDate: IsoDate | null;
    }
  | { readonly kind: "setIvOverride"; readonly id: string; readonly legIndex: number; readonly iv: number | null }
  | { readonly kind: "setCapitalOverride"; readonly id: string; readonly dollars: number | null }
  | { readonly kind: "addLeg"; readonly id: string; readonly right: OptionRight; readonly strike: number; readonly ratio: number }
  | { readonly kind: "addBlankLeg"; readonly id: string }
  | {
      readonly kind: "setLeg";
      readonly id: string;
      readonly legIndex: number;
      readonly instrument?: "call" | "put" | "stock";
      readonly side?: "long" | "short";
      readonly quantity?: number;
      readonly expiry?: IsoDate;
    }
  | { readonly kind: "removeLeg"; readonly id: string; readonly legIndex: number }
  | { readonly kind: "setLabel"; readonly id: string; readonly label: string }
  | { readonly kind: "setStock"; readonly id: string; readonly stock: { readonly shares: number; readonly averagePrice: number } | null }
  | { readonly kind: "duplicateStructure"; readonly id: string }
  | {
      readonly kind: "importHeld";
      readonly expiry: IsoDate;
      readonly label: string;
      readonly legs: readonly { readonly right: OptionRight; readonly strike: number; readonly ratio: number; readonly expiry?: IsoDate }[];
      readonly netPerShare: number;
      readonly stock: { readonly shares: number; readonly averagePrice: number } | null;
    }
  | { readonly kind: "retarget"; readonly id: string }
  | {
      readonly kind: "savePackage";
      readonly label: string;
      /** Ticker this package is priced against. Omitted packages use the loaded chain symbol. */
      readonly underlying?: string | null;
      readonly legs: readonly ({
        readonly instrument: "call" | "put" | "stock";
        readonly right: OptionRight | null;
        readonly strike: number | null;
        readonly ratio: number;
        readonly expiry: IsoDate | null;
      } & LegCost)[];
    };

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
  /** Days from the earliest fill or typed entry date. Null when no date is known. */
  readonly daysHeld: number | null;
  readonly ownHalfway: IsoDate;
  readonly midPerShare: number | null;
  readonly naturalPerShare: number | null;
  readonly usedPerShare: number;
  readonly debit: number;
  /** Quoted option net, before a synthetic is restated at parity. */
  readonly quotedDebit: number;
  /** Parity debit when the structure is a synthetic. Null otherwise. */
  readonly parityDebit: number | null;
  readonly risk: ExpiryRisk;
  readonly packageCost: number | null;
  readonly putProxy: number;
  readonly callRiskRequired: boolean;
  readonly greeks: { readonly delta: number; readonly gamma: number; readonly theta: number; readonly vega: number } | null;
  readonly sizing: Sizing;
  readonly curves: readonly { readonly horizonId: string; readonly points: readonly CurvePoint[] }[];
};

export type StructureEval = PricedStructure | { readonly status: "blocked"; readonly spec: StructureSpec; readonly reason: string };

export type LabEvaluation = {
  readonly entryDate: IsoDate;
  readonly spot: number;
  /** Rate, dividend yield, and IV source. Each leg keeps its solved entry IV across the price axis. */
  readonly assumptions: Assumptions;
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

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function createLab(chain: OptionChain): LabScenario {
  return {
    symbol: chain.symbol,
    assumptions: { rate: MODEL_RATE, dividendYield: MODEL_DIVIDEND_YIELD, ivSource: "mid", volShift: { mode: "points", amount: 0 } },
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
    legs: assignLegIds(
      resolved.legs.map((leg) =>
        leg.stock || leg.right == null || leg.strike == null
          ? stockLeg(leg.ratio, chain.spot)
          : optionLeg({ right: leg.right, strike: leg.strike, ratio: leg.ratio, expiry: leg.expiry ?? expiry, entry: legEntry(spec.entry.kind) }),
      ),
    ),
    origin: { request, tracking },
    resolveError: null,
  };
}

function applyOne(lab: LabScenario, edit: LabEdit, chain: OptionChain): LabScenario {
  switch (edit.kind) {
    case "setAssumptions":
      return {
        ...lab,
        assumptions: {
          ...lab.assumptions,
          ...edit.patch,
          rate: MODEL_RATE,
          dividendYield: MODEL_DIVIDEND_YIELD,
        },
      };
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
      let slot: number | null = null;
      for (let candidate = 0; candidate < LAB_LIMITS.structures; candidate++) {
        if (!used.has(candidate)) {
          slot = candidate;
          break;
        }
      }
      if (slot == null) return lab;
      const listed = nearestExpiry(chain, edit.expiry);
      if (!listed) return lab;
      const id = `s${lab.seq}`;
      const blank: StructureSpec = {
        id,
        label: edit.label?.trim() || LETTERS[slot] || "S",
        expiry: listed,
        snappedFrom: listed === edit.expiry ? null : edit.expiry,
        legs: [],
        entry: edit.entry ?? { kind: "mid" },
        capitalOverride: null,
        slot,
        origin: null,
        resolveError: null,
        underlying: null,
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
            if (leg.right == null || leg.strike == null) return leg;
            const snapped = nearestStrike(listedStrikes(chain, listed, leg.right), leg.strike);
            return snapped == null ? { ...leg, expiry: listed } : { ...leg, strike: snapped, expiry: listed };
          }),
        };
      });
    case "setStrike":
      return mapStructure(lab, edit.id, (spec) => ({
        ...spec,
        origin: spec.origin ? { ...spec.origin, tracking: false } : null,
        legs: spec.legs.map((leg, i) => {
          if (i !== edit.legIndex) return leg;
          if (leg.right == null || leg.expiry == null) return leg;
          const snapped = nearestStrike(listedStrikes(chain, leg.expiry, leg.right), edit.strike);
          return snapped == null ? leg : { ...leg, strike: snapped };
        }),
      }));
    case "stepStrike":
      return mapStructure(lab, edit.id, (spec) => ({
        ...spec,
        origin: spec.origin ? { ...spec.origin, tracking: false } : null,
        legs: spec.legs.map((leg, i) => {
          if (i !== edit.legIndex) return leg;
          if (leg.right == null || leg.strike == null || leg.expiry == null) return leg;
          const strikes = listedStrikes(chain, leg.expiry, leg.right);
          const idx = strikes.findIndex((s) => Math.round(s * 1000) === Math.round(leg.strike! * 1000));
          const next = strikes[idx + edit.steps];
          return next == null ? leg : { ...leg, strike: next };
        }),
      }));
    case "setEntry":
      return mapStructure(lab, edit.id, (spec) => ({
        ...spec,
        entry: edit.entry,
        legs: spec.legs.map((leg) => (leg.instrument === "stock" ? leg : { ...leg, entry: legEntry(edit.entry.kind) })),
      }));
    case "setLegCost":
      return mapStructure(lab, edit.id, (spec) => ({
        ...spec,
        legs: spec.legs.map((leg, index) => {
          if (index !== edit.legIndex) return leg;
          const manualPrice = edit.manualPrice != null && edit.manualPrice > 0 ? edit.manualPrice : null;
          return { ...leg, manualPrice, manualDate: edit.manualDate };
        }),
      }));
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
          legs: assignLegIds([
            ...spec.legs,
            optionLeg({
              right: edit.right,
              strike: snapped,
              ratio: edit.ratio,
              expiry: spec.expiry,
              entry: legEntry(spec.entry.kind),
            }),
          ]),
        };
      });
    }
    case "addBlankLeg":
      return mapStructure(lab, edit.id, (spec) => {
        if (spec.legs.length >= LAB_LIMITS.legs) return spec;
        const strike = nearestStrike(listedStrikes(chain, spec.expiry, "C"), chain.spot);
        if (strike == null) return spec;
        return {
          ...spec,
          origin: spec.origin ? { ...spec.origin, tracking: false } : null,
          resolveError: null,
          legs: assignLegIds([
            ...spec.legs,
            optionLeg({ right: "C", strike, ratio: 1, expiry: spec.expiry, entry: legEntry("mid") }),
          ]),
        };
      });
    case "setLeg":
      return mapStructure(lab, edit.id, (spec) => ({
        ...spec,
        origin: spec.origin ? { ...spec.origin, tracking: false } : null,
        legs: spec.legs.map((leg, index) => {
          if (index !== edit.legIndex) return leg;
          const instrument = edit.instrument ?? leg.instrument;
          const side = edit.side ?? leg.side;
          const quantity = edit.quantity ?? leg.quantity;
          const sign = side === "short" ? -1 : 1;
          if (instrument === "stock") {
            if (!(quantity > 0) || quantity > 1_000_000) return leg;
            const price = leg.entry.price ?? chain.spot;
            return { ...stockLeg(sign * quantity, price, leg.id), ...legCostOf(leg), entry: { kind: "limit", price } };
          }
          if (!Number.isInteger(quantity) || quantity < 1 || quantity > OPTION_QTY_CAP) return leg;
          const right: OptionRight = instrument === "put" ? "P" : "C";
          const expiry = edit.expiry ?? leg.expiry ?? spec.expiry;
          const listed = nearestExpiry(chain, expiry) ?? expiry;
          const strike = nearestStrike(listedStrikes(chain, listed, right), leg.strike ?? chain.spot);
          if (strike == null) return leg;
          return optionLeg({
            right,
            strike,
            ratio: sign * quantity,
            expiry: listed,
            ivOverride: leg.ivOverride,
            entry: leg.instrument === "stock" ? legEntry(spec.entry.kind) : leg.entry,
            id: leg.id,
            ...legCostOf(leg),
          });
        }),
      }));
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
    case "setStock":
      return mapStructure(lab, edit.id, (spec) => {
        const rest = spec.legs.filter((leg) => leg.instrument !== "stock");
        if (edit.stock == null) return { ...spec, legs: rest };
        const shares = edit.stock.shares;
        const averagePrice = edit.stock.averagePrice;
        if (!Number.isFinite(shares) || shares === 0 || Math.abs(shares) > 1_000_000) return spec;
        if (!Number.isFinite(averagePrice) || !(averagePrice > 0)) return spec;
        return { ...spec, legs: assignLegIds([...rest, stockLeg(shares, averagePrice)]) };
      });
    case "duplicateStructure": {
      if (lab.structures.length >= LAB_LIMITS.structures) return lab;
      const spec = lab.structures.find((item) => item.id === edit.id);
      if (!spec) return lab;
      const used = new Set(lab.structures.map((item) => item.slot));
      let slot: number | null = null;
      for (let candidate = 0; candidate < LAB_LIMITS.structures; candidate++) {
        if (!used.has(candidate)) {
          slot = candidate;
          break;
        }
      }
      if (slot == null) return lab;
      const base = spec.label.replace(/ alt( \d+)?$/, "");
      const taken = new Set(lab.structures.map((item) => item.label));
      let label = `${base} alt`.slice(0, 40);
      let n = 2;
      while (taken.has(label)) {
        label = `${base} alt ${n}`.slice(0, 40);
        n += 1;
      }
      const copy: StructureSpec = {
        ...spec,
        id: `s${lab.seq}`,
        slot,
        label,
        origin: spec.origin ? { ...spec.origin, tracking: false } : null,
      };
      return { ...lab, seq: lab.seq + 1, structures: [...lab.structures, copy] };
    }
    case "importHeld": {
      if (lab.structures.length >= LAB_LIMITS.structures) return lab;
      if (!Number.isFinite(edit.netPerShare) || edit.legs.length < 1) return lab;
      const stock = edit.stock;
      if (stock && (!Number.isFinite(stock.shares) || stock.shares === 0 || !(stock.averagePrice > 0))) return lab;
      const ratiosOk = edit.legs.every((leg) => Number.isInteger(leg.ratio) && leg.ratio !== 0 && Math.abs(leg.ratio) <= OPTION_QTY_CAP);
      if (!ratiosOk) return lab;
      const latest = edit.legs.reduce((far, leg) => ((leg.expiry ?? edit.expiry) > far ? (leg.expiry ?? edit.expiry) : far), edit.expiry);
      const listedExpiry = chain.expiries.some((expiry) => expiry.date === latest);
      const expiry = listedExpiry ? latest : nearestExpiry(chain, latest);
      if (!expiry) return lab;
      const missing = edit.legs.filter((leg) => {
        const legExpiry = leg.expiry ?? expiry;
        return !listedStrikes(chain, legExpiry, leg.right).some((strike) => Math.round(strike * 1000) === Math.round(leg.strike * 1000));
      });
      const blocked = !listedExpiry || missing.length > 0;
      const reason = !listedExpiry
        ? `${latest} is not on this chain.`
        : `Not listed: ${missing.map((leg) => `${leg.strike} ${leg.right}`).join(", ")}.`;
      if (edit.legs.length + (stock ? 1 : 0) > HELD_LEG_CAP) return lab;
      const used = new Set(lab.structures.map((item) => item.slot));
      let slot: number | null = null;
      for (let candidate = 0; candidate < LAB_LIMITS.structures; candidate++) {
        if (!used.has(candidate)) {
          slot = candidate;
          break;
        }
      }
      if (slot == null) return lab;
      const optionLegs = blocked
        ? []
        : edit.legs.map((leg) =>
            optionLeg({
              right: leg.right,
              strike: leg.strike,
              ratio: leg.ratio,
              expiry: leg.expiry ?? expiry,
              entry: legEntry("mid"),
            }),
          );
      const legs = blocked || !stock ? optionLegs : [...optionLegs, stockLeg(stock.shares, stock.averagePrice)];
      const label = edit.label.trim().slice(0, 40) || "Held";
      const spec: StructureSpec = {
        id: `s${lab.seq}`,
        label,
        expiry,
        snappedFrom: listedExpiry ? null : latest,
        legs: assignLegIds(legs),
        entry: { kind: "limit", netPerShare: edit.netPerShare },
        capitalOverride: null,
        slot,
        origin: {
          request: { template: "custom", legs: edit.legs.map((leg) => ({ right: leg.right, strike: leg.strike, ratio: leg.ratio })) },
          tracking: false,
        },
        resolveError: blocked ? reason : null,
        underlying: null,
      };
      return { ...lab, seq: lab.seq + 1, structures: [...lab.structures, spec] };
    }
    case "retarget":
      return mapStructure(lab, edit.id, (spec) => {
        if (!spec.origin) return spec;
        return withLegs(chain, lab, spec, spec.origin.request, spec.expiry, true);
      });
    case "savePackage": {
      if (lab.structures.length >= LAB_LIMITS.structures) return lab;
      if (edit.legs.length < 1 || edit.legs.length > HELD_LEG_CAP) return lab;
      const options = edit.legs.filter((leg) => leg.instrument !== "stock");
      const stocks = edit.legs.filter((leg) => leg.instrument === "stock");
      const optionsOk = options.every(
        (leg) =>
          (leg.right === "C" || leg.right === "P") &&
          leg.strike != null &&
          leg.strike > 0 &&
          leg.expiry != null &&
          Number.isInteger(leg.ratio) &&
          leg.ratio !== 0 &&
          Math.abs(leg.ratio) <= OPTION_QTY_CAP,
      );
      const stocksOk = stocks.every((leg) => Number.isFinite(leg.ratio) && leg.ratio !== 0 && Math.abs(leg.ratio) <= 1_000_000);
      if (!optionsOk || !stocksOk) return lab;
      const latest = options.reduce<IsoDate | null>((far, leg) => {
        const date = leg.expiry ?? far;
        return far == null || (date != null && date > far) ? date : far;
      }, null);
      const listedExpiry = latest == null || chain.expiries.some((expiry) => expiry.date === latest);
      const anchor = latest ?? chain.expiries.at(-1)?.date ?? chain.tradeDate;
      const expiry = listedExpiry ? anchor : nearestExpiry(chain, anchor);
      if (!expiry) return lab;
      const missing = options.filter((leg) => {
        const legExpiry = leg.expiry ?? expiry;
        const right = leg.right === "P" ? "P" : "C";
        return !listedStrikes(chain, legExpiry, right).some((strike) => Math.round(strike * 1000) === Math.round((leg.strike ?? 0) * 1000));
      });
      const blocked = !listedExpiry || missing.length > 0;
      const reason = !listedExpiry
        ? `${latest} is not on this chain.`
        : `Not listed: ${missing.map((leg) => `${leg.strike} ${leg.right}`).join(", ")}.`;
      const used = new Set(lab.structures.map((item) => item.slot));
      let slot: number | null = null;
      for (let candidate = 0; candidate < LAB_LIMITS.structures; candidate++) {
        if (!used.has(candidate)) {
          slot = candidate;
          break;
        }
      }
      if (slot == null) return lab;
      const built = blocked
        ? []
        : edit.legs.flatMap((leg) => {
            const cost = legCostOf(leg);
            if (leg.instrument === "stock") {
              const price = leg.manualPrice ?? leg.bookPrice ?? chain.spot;
              if (!(price > 0)) return [];
              return [{ ...stockLeg(leg.ratio, price), ...cost }];
            }
            return [
              optionLeg({
                right: leg.right === "P" ? "P" : "C",
                strike: leg.strike ?? 0,
                ratio: leg.ratio,
                expiry: leg.expiry ?? expiry,
                entry: legEntry("mid"),
                ...cost,
              }),
            ];
          });
      const label = edit.label.trim().slice(0, 40) || "Book";
      const named = (edit.underlying ?? "").trim().toUpperCase();
      const underlying = named.length >= 1 && named.length <= 12 ? named : chain.symbol;
      const spec: StructureSpec = {
        id: `s${lab.seq}`,
        label,
        expiry,
        snappedFrom: listedExpiry ? null : latest,
        legs: assignLegIds(built),
        entry: { kind: "mid" },
        capitalOverride: null,
        slot,
        origin: null,
        resolveError: blocked ? reason : null,
        underlying,
      };
      return { ...lab, seq: lab.seq + 1, structures: [...lab.structures, spec] };
    }
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
      const latest = expiries.length ? expiries.reduce((a, b) => (a > b ? a : b)) : null;
      if (!latest) continue;
      const showDate = expiries.some((date) => date !== latest);
      for (const step of forwardDateSteps(chain.tradeDate, latest)) {
        horizons.push({
          id: forwardStepId(step),
          date: step.date,
          label: forwardStepLabel(step, showDate),
          shared: true,
          settlement: step.kind === "expiry",
          structureId: null,
        });
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

export function packageCostOf(row: {
  spec: { capitalOverride: number | null };
  debit: number;
  legs: readonly PricedLeg[];
  risk: ExpiryRisk;
}): number | null {
  return structurePackageCost(row.legs, row.debit, row.risk, row.spec.capitalOverride).cost;
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
          const value = markAt(
            chain,
            structure.spec.expiry,
            structure.legs,
            {
              rate: MODEL_RATE,
              dividendYield: MODEL_DIVIDEND_YIELD,
              ivSource: lab.assumptions.ivSource,
              volShift: lab.assumptions.volShift,
            },
            spot,
            h.date,
          );
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
 * Entry omega (the tile's Leverage now): today's share-equivalent delta times spot,
 * divided by dollars invested. Dollars invested is the net debit of the packages bought.
 * Idle cash is not in the denominator.
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
export function packageOutlay(
  debit: number,
  maxLoss: number | "unbounded",
  override: number | null,
  detail?: { legs: readonly PricedLeg[]; slopeAbove: number; slopeBelow: number },
): number | null {
  if (detail) return structurePackageCost(detail.legs, debit, { ...detail, maxLoss }, override).cost;
  if (override != null && override > 0) return override;
  if (debit > 0) return debit;
  if (typeof maxLoss === "number" && maxLoss > 0) return maxLoss;
  return null;
}

function sizeOf(
  basis: Basis,
  cost: number | null,
  delta: number | null,
  spot: number,
  matched: MatchedBasis | null,
): Sizing {
  if (basis.kind === "matchExpensive") {
    if (matched == null || cost == null || !(cost > 0)) return { status: "needsCapitalOverride" };
    const packages = matched.capital / cost;
    return { status: "sized", packages, invested: matched.capital, idleCash: 0, ...exposureStats(packages, matched.capital, delta, spot) };
  }
  const capitalPer = cost;
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
    const cost = packageOutlay(row.debit, row.risk.maxLoss, row.spec.capitalOverride, {
      legs: row.legs,
      slopeAbove: row.risk.slopeAbove,
      slopeBelow: row.risk.slopeBelow,
    });
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
    const modelAssumptions = { rate: MODEL_RATE, dividendYield: MODEL_DIVIDEND_YIELD, ivSource: lab.assumptions.ivSource };
    const quoted = priceLegs(chain, spec.legs, modelAssumptions, underlyingModelIv(chain));
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
    const marks = spec.legs.map((leg, index) => (leg.instrument === "stock" ? chain.spot : quoted.legs[index]?.mid ?? null));
    const fromBook = packageUsesEntryCost(spec.legs) ? entryPackageDebit(spec.legs, marks) : null;
    if (packageUsesEntryCost(spec.legs) && fromBook == null) {
      blocked.push({ status: "blocked", spec, reason: "No entry price." });
      issues.push({ severity: "block", structureId: spec.id, code: "no-entry", message: "No entry price." });
      continue;
    }
    const usedPerShare = fromBook
      ? fromBook.optionPerShare
      : spec.entry.kind === "limit"
        ? spec.entry.netPerShare
        : spec.entry.kind === "natural"
          ? naturalPerShare
          : midPerShare;
    if (usedPerShare == null) {
      blocked.push({ status: "blocked", spec, reason: "No entry price." });
      issues.push({ severity: "block", structureId: spec.id, code: "no-entry", message: "No entry price." });
      continue;
    }
    const quotedDebit = fromBook ? fromBook.debit : entryDollars(usedPerShare) + Math.round(stockEntryDollars(spec.legs));
    const shape = syntheticShape(spec.legs);
    const call = spec.legs.find((leg) => leg.instrument === "call");
    const years =
      call?.expiry == null ? 0 : calendarDaysBetween(chain.tradeDate, call.expiry) / 365;
    const parityDebit =
      fromBook == null && shape && call?.strike != null && spec.entry.kind !== "limit"
        ? parityPackageDebit(chain.spot, call.strike, years, call.quantity, shape)
        : null;
    const debit = parityDebit ?? quotedDebit;
    const missingCost = spec.legs.filter(legMissingBookCost);
    if (missingCost.length === 1) {
      const leg = missingCost[0]!;
      const name = leg.instrument === "stock" ? "the shares" : `the ${leg.strike} ${leg.instrument}`;
      issues.push({
        severity: "warn",
        structureId: spec.id,
        code: "missing-cost",
        message: `${spec.label}: no book cost for ${name}. That leg uses the mark.`,
      });
    } else if (missingCost.length > 1) {
      issues.push({
        severity: "warn",
        structureId: spec.id,
        code: "missing-cost",
        message: `${spec.label}: ${missingCost.length} legs have no book cost. Those legs use the mark.`,
      });
    }
    const risk = expiryRisk(quoted.legs, debit, chain.spot);
    const budget = structurePackageCost(quoted.legs, debit, risk, spec.capitalOverride);
    const greeks = packageGreeks(chain, quoted.legs, modelAssumptions);
    for (const b of risk.breakevens) axisExtras.push(b);
    for (const leg of quoted.legs) if (leg.strike != null) axisExtras.push(leg.strike);
    const days = calendarDaysBetween(chain.tradeDate, spec.expiry);
    priced.push({
      status: "priced",
      spec,
      legs: quoted.legs,
      days,
      daysHeld: daysHeldFromLegs(spec.legs, chain.tradeDate),
      ownHalfway: addCalendarDays(chain.tradeDate, Math.floor(days / 2)),
      midPerShare,
      naturalPerShare,
      usedPerShare,
      debit,
      quotedDebit,
      parityDebit,
      risk,
      packageCost: budget.cost,
      putProxy: budget.putProxy,
      callRiskRequired: budget.callRiskRequired,
      greeks,
      sizing: { status: "needsCapitalOverride" },
      curves: [],
    });
  }

  const match = matchedBasis(lab.basis, priced);
  const sized = priced.map((row) => {
    const sizing = sizeOf(lab.basis, row.packageCost, row.greeks?.delta ?? null, chain.spot, match);
    if (sizing.status === "needsCapitalOverride") {
      issues.push({
        severity: "warn",
        structureId: row.spec.id,
        code: "needs-capital",
        message: row.putProxy > 0
          ? "Undefined risk on the call side. The put side is a cash-secured proxy. Sizing waits for a typed call-side number. No broker margin."
          : "Undefined risk on the call side. Sizing waits for a typed dollars-at-risk number. No broker margin.",
      });
    }
    if (sizing.status === "sized" && sizing.packages === 0 && lab.basis.kind === "equalCapital") {
      const cost = row.packageCost;
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
      s.legs.some((leg) => {
        if (leg.right == null || leg.strike == null) return false;
        return !listedStrikes(chain, leg.expiry ?? s.expiry, leg.right).some((k) => Math.round(k * 1000) === Math.round(leg.strike! * 1000));
      }),
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
    assumptions: lab.assumptions,
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

function zoneSeriesOf(row: PricedStructure, label: string): ZoneSeries | null {
  if (row.sizing.status === "needsCapitalOverride" || !(row.sizing.packages > 0)) return null;
  const packages = row.sizing.packages;
  const strikes = [...new Set(row.legs.map((leg) => leg.strike).filter((strike): strike is number => strike != null))].sort((a, b) => a - b);
  const last = strikes[strikes.length - 1] ?? 0;
  const slope =
    last > 0 ? (expiryPnl(row.legs, row.debit, last + 1) - expiryPnl(row.legs, row.debit, last)) * packages : 0;
  return {
    id: row.spec.id,
    label,
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
  const names = structureDisplayNames(structures.map((row) => ({ id: row.spec.id, label: row.spec.label })));
  const groups = new Map<IsoDate, ZoneSeries[]>();
  for (const row of structures) {
    if (row.status !== "priced") continue;
    const series = zoneSeriesOf(row, names.get(row.spec.id) ?? row.spec.label);
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
  const names = structureDisplayNames(structures.map((row) => ({ id: row.spec.id, label: row.spec.label })));
  const out: ModelCrossover[] = [];
  for (const horizon of horizons) {
    if (horizon.settlement) continue;
    const sampled = structures.flatMap((row) => {
      if (row.status !== "priced") return [];
      const curve = row.curves.find((item) => item.horizonId === horizon.id);
      if (!curve) return [];
      return [{ id: row.spec.id, label: names.get(row.spec.id) ?? row.spec.label, points: curve.points }];
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

export function expiryPnlAtSpot(legs: Parameters<typeof expiryPnl>[0], debit: number, spot: number): number {
  return expiryPnl(legs, debit, spot);
}

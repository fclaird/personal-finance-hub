import { isoDate, type IsoDate, type OptionRight } from "@/lib/optionChain/chain";
import type {
  Basis,
  EntryBasis,
  HorizonSpec,
  LabScenario,
  LegSpec,
  SpotWindow,
  StructureSpec,
  StructureSlot,
} from "@/lib/strategyLab/lab";
import type { Assumptions } from "@/lib/strategyLab/internal/pricing";
import type { StrikeTarget, TemplateRequest } from "@/lib/strategyLab/internal/templates";

export const SCENARIO_STORAGE_KEY = "fh.strategyLab.scenarios.v1";

export type NamedScenario = {
  readonly name: string;
  readonly savedAt: string;
  readonly scenario: LabScenario;
};

type Store = Pick<Storage, "getItem" | "setItem">;

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return raw != null && typeof raw === "object" && !Array.isArray(raw);
}

function finite(raw: unknown): number | null {
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

function dateOf(raw: unknown): IsoDate | null {
  if (typeof raw !== "string") return null;
  try {
    return isoDate(raw);
  } catch {
    return null;
  }
}

function parseTarget(raw: unknown): StrikeTarget | null {
  if (!isRecord(raw)) return null;
  if (raw.by === "strike") {
    const strike = finite(raw.strike);
    return strike != null && strike > 0 ? { by: "strike", strike } : null;
  }
  if (raw.by === "delta") {
    const delta = finite(raw.delta);
    return delta != null && delta > 0 && delta < 1 ? { by: "delta", delta } : null;
  }
  return null;
}

function parseRatio(raw: unknown): number | null {
  const ratio = finite(raw);
  if (ratio == null || !Number.isInteger(ratio) || ratio === 0 || Math.abs(ratio) > 100) return null;
  return ratio;
}

function parseRight(raw: unknown): OptionRight | null {
  return raw === "C" || raw === "P" ? raw : null;
}

function parseTemplate(raw: unknown): TemplateRequest | null {
  if (!isRecord(raw)) return null;
  if (raw.template === "longCall" || raw.template === "syntheticLong") {
    const strike = parseTarget(raw.strike);
    return strike ? { template: raw.template, strike } : null;
  }
  if (raw.template === "shortStrangle") {
    const put = parseTarget(raw.put);
    const call = parseTarget(raw.call);
    return put && call ? { template: "shortStrangle", put, call } : null;
  }
  if (raw.template === "callDebitSpread" || raw.template === "zebra") {
    const long = parseTarget(raw.long);
    const short = parseTarget(raw.short);
    return long && short ? { template: raw.template, long, short } : null;
  }
  if (raw.template === "custom") {
    if (!Array.isArray(raw.legs) || raw.legs.length < 1 || raw.legs.length > 6) return null;
    const legs: { right: OptionRight; strike: number; ratio: number }[] = [];
    for (const leg of raw.legs) {
      if (!isRecord(leg)) return null;
      const right = parseRight(leg.right);
      const strike = finite(leg.strike);
      const ratio = parseRatio(leg.ratio);
      if (!right || strike == null || !(strike > 0) || ratio == null) return null;
      legs.push({ right, strike, ratio });
    }
    return { template: "custom", legs };
  }
  return null;
}

function parseHorizon(raw: unknown): HorizonSpec | null {
  if (!isRecord(raw) || typeof raw.kind !== "string") return null;
  if (raw.kind === "entry") return { kind: "entry" };
  if (raw.kind === "anchorExpiry") return { kind: "anchorExpiry" };
  if (raw.kind === "quartersToAnchor") return { kind: "quartersToAnchor" };
  if (raw.kind === "date") {
    const date = dateOf(raw.date);
    return date ? { kind: "date", date } : null;
  }
  if (raw.kind === "monthsFromEntry") {
    const months = finite(raw.months);
    return months != null && months > 0 ? { kind: "monthsFromEntry", months } : null;
  }
  if (raw.kind === "fractionToAnchor") {
    const fraction = finite(raw.fraction);
    return fraction != null && fraction > 0 && fraction <= 1 ? { kind: "fractionToAnchor", fraction } : null;
  }
  return null;
}

function parseEntry(raw: unknown): EntryBasis | null {
  if (!isRecord(raw)) return null;
  if (raw.kind === "mid" || raw.kind === "natural") return { kind: raw.kind };
  if (raw.kind === "limit") {
    const netPerShare = finite(raw.netPerShare);
    return netPerShare == null ? null : { kind: "limit", netPerShare };
  }
  return null;
}

function parseLeg(raw: unknown): LegSpec | null {
  if (!isRecord(raw)) return null;
  const right = parseRight(raw.right);
  const strike = finite(raw.strike);
  const ratio = parseRatio(raw.ratio);
  if (!right || strike == null || !(strike > 0) || ratio == null) return null;
  let ivOverride: number | null = null;
  if (raw.ivOverride != null) {
    const iv = finite(raw.ivOverride);
    if (iv == null || iv < 0) return null;
    ivOverride = iv;
  }
  return { right, strike, ratio, ivOverride };
}

function parseStructure(raw: unknown, seenSlots: Set<number>, seenIds: Set<string>): StructureSpec | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.id !== "string" || raw.id.length < 1 || raw.id.length > 40 || seenIds.has(raw.id)) return null;
  if (typeof raw.label !== "string" || raw.label.trim().length < 1 || raw.label.length > 40) return null;
  const slot = finite(raw.slot);
  if (slot == null || !Number.isInteger(slot) || slot < 0 || slot > 3 || seenSlots.has(slot)) return null;
  const expiry = dateOf(raw.expiry);
  if (!expiry) return null;
  let snappedFrom: IsoDate | null = null;
  if (raw.snappedFrom != null) {
    snappedFrom = dateOf(raw.snappedFrom);
    if (!snappedFrom) return null;
  }
  if (!Array.isArray(raw.legs) || raw.legs.length > 6) return null;
  const legs: LegSpec[] = [];
  for (const leg of raw.legs) {
    const parsed = parseLeg(leg);
    if (!parsed) return null;
    legs.push(parsed);
  }
  const entry = parseEntry(raw.entry);
  if (!entry) return null;
  let capitalOverride: number | null = null;
  if (raw.capitalOverride != null) {
    const dollars = finite(raw.capitalOverride);
    if (dollars == null || !(dollars > 0)) return null;
    capitalOverride = dollars;
  }
  let origin: StructureSpec["origin"] = null;
  if (raw.origin != null) {
    if (!isRecord(raw.origin) || typeof raw.origin.tracking !== "boolean") return null;
    const request = parseTemplate(raw.origin.request);
    if (!request) return null;
    origin = { request, tracking: raw.origin.tracking };
  }
  let resolveError: string | null = null;
  if (raw.resolveError != null) {
    if (typeof raw.resolveError !== "string" || raw.resolveError.length > 200) return null;
    resolveError = raw.resolveError;
  }
  seenIds.add(raw.id);
  seenSlots.add(slot);
  return {
    id: raw.id,
    label: raw.label.trim(),
    expiry,
    snappedFrom,
    legs,
    entry,
    capitalOverride,
    slot: slot as StructureSlot,
    origin,
    resolveError,
  };
}

function parseAssumptions(raw: unknown): Assumptions | null {
  if (!isRecord(raw)) return null;
  const rate = finite(raw.rate);
  const dividendYield = finite(raw.dividendYield);
  if (rate == null || dividendYield == null || dividendYield < 0) return null;
  if (raw.ivSource !== "mid" && raw.ivSource !== "feed") return null;
  return { rate, dividendYield, ivSource: raw.ivSource };
}

function parseBasis(raw: unknown): Basis | null {
  if (!isRecord(raw)) return null;
  if (raw.kind === "perPackage") return { kind: "perPackage" };
  if (raw.kind === "equalCapital") {
    const capital = finite(raw.capital);
    if (capital == null || !(capital > 0)) return null;
    if (raw.units !== "whole" && raw.units !== "fractional") return null;
    return { kind: "equalCapital", capital, units: raw.units };
  }
  return null;
}

function parseWindow(raw: unknown): SpotWindow | null {
  if (!isRecord(raw)) return null;
  if (raw.kind === "fit") return { kind: "fit" };
  if (raw.kind === "manual") {
    const min = finite(raw.min);
    const max = finite(raw.max);
    if (min == null || max == null || !(max > min)) return null;
    return { kind: "manual", min, max };
  }
  return null;
}

/** Rebuild a scenario from known fields. Anything unexpected, including a bad horizon, is null. */
export function parseScenario(raw: unknown): LabScenario | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.symbol !== "string" || !/^[A-Z][A-Z0-9.]{0,9}$/.test(raw.symbol)) return null;
  const assumptions = parseAssumptions(raw.assumptions);
  const basis = parseBasis(raw.basis);
  const window = parseWindow(raw.window);
  if (!assumptions || !basis || !window) return null;
  if (typeof raw.showStock !== "boolean" || typeof raw.compareStock !== "boolean") return null;
  const seq = finite(raw.seq);
  if (seq == null || !Number.isInteger(seq) || seq < 1 || seq > 1_000_000) return null;
  if (!isRecord(raw.createdFrom)) return null;
  const spot = finite(raw.createdFrom.spot);
  const tradeDate = dateOf(raw.createdFrom.tradeDate);
  if (spot == null || !(spot > 0) || !tradeDate) return null;
  if (!Array.isArray(raw.horizons) || raw.horizons.length > 24) return null;
  const horizons: HorizonSpec[] = [];
  for (const horizon of raw.horizons) {
    const parsed = parseHorizon(horizon);
    if (!parsed) return null;
    horizons.push(parsed);
  }
  if (!Array.isArray(raw.structures) || raw.structures.length > 4) return null;
  const structures: StructureSpec[] = [];
  const seenSlots = new Set<number>();
  const seenIds = new Set<string>();
  for (const structure of raw.structures) {
    const parsed = parseStructure(structure, seenSlots, seenIds);
    if (!parsed) return null;
    structures.push(parsed);
  }
  return {
    symbol: raw.symbol,
    assumptions,
    basis,
    horizons,
    structures,
    window,
    showStock: raw.showStock,
    compareStock: raw.compareStock,
    seq,
    createdFrom: { spot, tradeDate },
  };
}

function parseName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim();
  if (name.length < 1 || name.length > 40) return null;
  if (/[\u0000-\u001f]/.test(name)) return null;
  return name;
}

/** Drop bad entries. A blob that is not a v1 library becomes an empty list. */
export function parseLibrary(raw: unknown): NamedScenario[] {
  if (!isRecord(raw) || raw.v !== 1 || !Array.isArray(raw.scenarios)) return [];
  const out: NamedScenario[] = [];
  const seen = new Set<string>();
  for (const item of raw.scenarios) {
    if (!isRecord(item)) continue;
    const name = parseName(item.name);
    const scenario = parseScenario(item.scenario);
    if (!name || !scenario || seen.has(name)) continue;
    if (typeof item.savedAt !== "string" || item.savedAt.length < 1 || item.savedAt.length > 40) continue;
    seen.add(name);
    out.push({ name, savedAt: item.savedAt, scenario });
  }
  return out;
}

/** Replace a same-named save. Returns null when the name is empty or longer than 40 characters. */
export function upsertScenario(
  library: readonly NamedScenario[],
  name: string,
  scenario: LabScenario,
  savedAt: string,
): NamedScenario[] | null {
  const clean = parseName(name);
  const parsed = parseScenario(scenario);
  if (!clean || !parsed || savedAt.length < 1 || savedAt.length > 40) return null;
  const next = { name: clean, savedAt, scenario: parsed };
  const without = library.filter((item) => item.name !== clean);
  return [...without, next];
}

export function readLibrary(storage: Store): NamedScenario[] {
  try {
    const text = storage.getItem(SCENARIO_STORAGE_KEY);
    if (!text) return [];
    return parseLibrary(JSON.parse(text) as unknown);
  } catch {
    return [];
  }
}

/** Round-trip every scenario through the parser before it is written. */
export function writeLibrary(storage: Store, library: readonly NamedScenario[]): void {
  const scenarios = parseLibrary({
    v: 1,
    scenarios: library.map((item) => ({ name: item.name, savedAt: item.savedAt, scenario: item.scenario })),
  });
  storage.setItem(SCENARIO_STORAGE_KEY, JSON.stringify({ v: 1, scenarios }));
}

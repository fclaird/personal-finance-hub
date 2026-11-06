import { isoDate, type IsoDate, type OptionRight } from "@/lib/optionChain/chain";
import { LAB_LIMITS, type Basis, type EntryBasis, type HorizonSpec, type LabScenario, type LegSpec, type SpotWindow, type StructureSpec, type StructureSlot } from "@/lib/strategyLab/lab";
import { assignLegIds, legEntry, parseStoredLeg, stockFromSidecar } from "@/lib/strategyLab/legs";
import { MODEL_DIVIDEND_YIELD, MODEL_RATE } from "@/lib/strategyLab/modelAssumptions";
import type { Assumptions } from "@/lib/strategyLab/internal/pricing";
import type { StrikeTarget, TemplateRequest } from "@/lib/strategyLab/internal/templates";

export const SCENARIO_STORAGE_KEY_V1 = "fh.strategyLab.scenarios.v1";
export const SCENARIO_STORAGE_KEY = "fh.strategyLab.scenarios.v2";

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
  if (!isRecord(raw) || typeof raw.template !== "string") return null;
  const template = raw.template === "callDebitSpread" ? "callDebitSpread" : raw.template;
  const strike = () => parseTarget(raw.strike);
  const pair = () => {
    const long = parseTarget(raw.long);
    const short = parseTarget(raw.short);
    return long && short ? { long, short } : null;
  };
  const wings = () => {
    const put = parseTarget(raw.put);
    const call = parseTarget(raw.call);
    return put && call ? { put, call } : null;
  };
  if (
    template === "longCall" ||
    template === "longPut" ||
    template === "cashSecuredPut" ||
    template === "syntheticLong" ||
    template === "syntheticShort" ||
    template === "longStraddle" ||
    template === "shortStraddle"
  ) {
    const picked = strike();
    return picked ? { template, strike: picked } : null;
  }
  if (template === "callDebit" || template === "callDebitSpread" || template === "putDebit" || template === "callCredit" || template === "putCredit" || template === "zebra") {
    const picked = pair();
    return picked ? { template, ...picked } : null;
  }
  if (template === "longStrangle" || template === "shortStrangle" || template === "riskReversal" || template === "collar") {
    const picked = wings();
    return picked ? { template, ...picked } : null;
  }
  if (template === "coveredCall") {
    const call = parseTarget(raw.call);
    return call ? { template: "coveredCall", call } : null;
  }
  if (template === "ironCondor") {
    const putLong = parseTarget(raw.putLong);
    const putShort = parseTarget(raw.putShort);
    const callShort = parseTarget(raw.callShort);
    const callLong = parseTarget(raw.callLong);
    return putLong && putShort && callShort && callLong ? { template, putLong, putShort, callShort, callLong } : null;
  }
  if (template === "ironButterfly" || template === "callButterfly" || template === "putButterfly") {
    const low = parseTarget(raw.low);
    const body = parseTarget(raw.body);
    const high = parseTarget(raw.high);
    return low && body && high ? { template, low, body, high } : null;
  }
  if (template === "calendar") {
    const right = parseRight(raw.right);
    const front = dateOf(raw.front);
    const picked = strike();
    return right && front && picked ? { template, right, front, strike: picked } : null;
  }
  if (template === "diagonal") {
    const right = parseRight(raw.right);
    const front = dateOf(raw.front);
    const frontStrike = parseTarget(raw.frontStrike);
    const backStrike = parseTarget(raw.backStrike);
    return right && front && frontStrike && backStrike ? { template, right, front, frontStrike, backStrike } : null;
  }
  if (template === "custom") {
    if (!Array.isArray(raw.legs) || raw.legs.length < 1 || raw.legs.length > 8) return null;
    const legs: { right: OptionRight; strike: number; ratio: number }[] = [];
    for (const leg of raw.legs) {
      if (!isRecord(leg)) return null;
      const right = parseRight(leg.right);
      const legStrike = finite(leg.strike);
      const ratio = parseRatio(leg.ratio);
      if (!right || legStrike == null || !(legStrike > 0) || ratio == null) return null;
      legs.push({ right, strike: legStrike, ratio });
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

function parseLeg(raw: unknown, expiry: IsoDate, entry: EntryBasis): LegSpec | null {
  return parseStoredLeg(raw, expiry, legEntry(entry.kind));
}

function parseStructure(raw: unknown, seenSlots: Set<number>, seenIds: Set<string>): StructureSpec | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.id !== "string" || raw.id.length < 1 || raw.id.length > 40 || seenIds.has(raw.id)) return null;
  if (typeof raw.label !== "string" || raw.label.trim().length < 1 || raw.label.length > 40) return null;
  const slot = finite(raw.slot);
  if (slot == null || !Number.isInteger(slot) || slot < 0 || slot >= LAB_LIMITS.structures || seenSlots.has(slot)) return null;
  const expiry = dateOf(raw.expiry);
  if (!expiry) return null;
  let snappedFrom: IsoDate | null = null;
  if (raw.snappedFrom != null) {
    snappedFrom = dateOf(raw.snappedFrom);
    if (!snappedFrom) return null;
  }
  if (!Array.isArray(raw.legs) || raw.legs.length > LAB_LIMITS.legs) return null;
  const entry = parseEntry(raw.entry);
  if (!entry) return null;
  const legs: LegSpec[] = [];
  for (const leg of raw.legs) {
    const parsed = parseLeg(leg, expiry, entry);
    if (!parsed) return null;
    legs.push(parsed);
  }
  if (!legs.some((leg) => leg.instrument === "stock")) {
    const stock = stockFromSidecar(raw.stock);
    if (stock && legs.length < LAB_LIMITS.legs) legs.push(stock);
  }
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
    legs: assignLegIds(legs),
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
  const volShift = parseVolShift(raw.volShift);
  if (raw.volShift != null && volShift == null) return null;
  return {
    rate: MODEL_RATE,
    dividendYield: MODEL_DIVIDEND_YIELD,
    ivSource: raw.ivSource,
    volShift: volShift ?? { mode: "points", amount: 0 },
  };
}

function parseVolShift(raw: unknown): { mode: "points" | "pct"; amount: number } | null {
  if (raw == null) return null;
  if (!isRecord(raw)) return null;
  if (raw.mode !== "points" && raw.mode !== "pct") return null;
  const amount = finite(raw.amount);
  if (amount == null) return null;
  return { mode: raw.mode, amount };
}

function parseBasis(raw: unknown): Basis | null {
  if (!isRecord(raw)) return null;
  if (raw.kind === "perPackage") return { kind: "perPackage" };
  if (raw.kind === "matchExpensive") return { kind: "matchExpensive" };
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
  if (!Array.isArray(raw.structures) || raw.structures.length > LAB_LIMITS.structures) return null;
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

/** Drop bad entries. A blob that is not a v1 or v2 library becomes an empty list. */
export function parseLibrary(raw: unknown): NamedScenario[] {
  if (!isRecord(raw) || (raw.v !== 1 && raw.v !== 2) || !Array.isArray(raw.scenarios)) return [];
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

function readKey(storage: Store, key: string): NamedScenario[] | null {
  const text = storage.getItem(key);
  if (!text) return null;
  try {
    return parseLibrary(JSON.parse(text) as unknown);
  } catch {
    return null;
  }
}

export function readLibrary(storage: Store): NamedScenario[] {
  return readKey(storage, SCENARIO_STORAGE_KEY) ?? readKey(storage, SCENARIO_STORAGE_KEY_V1) ?? [];
}

/** Round-trip every scenario through the parser before it is written. */
export function writeLibrary(storage: Store, library: readonly NamedScenario[]): void {
  const scenarios = parseLibrary({
    v: 2,
    scenarios: library.map((item) => ({ name: item.name, savedAt: item.savedAt, scenario: item.scenario })),
  });
  storage.setItem(SCENARIO_STORAGE_KEY, JSON.stringify({ v: 2, scenarios }));
}

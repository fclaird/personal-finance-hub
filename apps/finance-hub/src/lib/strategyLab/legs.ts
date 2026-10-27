import { isoDate, type IsoDate, type OptionRight } from "@/lib/optionChain/chain";
import { MODEL_RATE } from "@/lib/strategyLab/modelAssumptions";

export type Instrument = "call" | "put" | "stock";
export type Side = "long" | "short";

export type LegEntry = {
  readonly kind: "mid" | "natural" | "limit";
  readonly price: number | null;
};

/** Price paid and fill date. Manual wins over the book. Both empty means the live mark. */
export type LegCost = {
  readonly bookPrice: number | null;
  readonly bookDate: IsoDate | null;
  readonly manualPrice: number | null;
  readonly manualDate: IsoDate | null;
  readonly missingCost: boolean;
};

export const NO_LEG_COST: LegCost = {
  bookPrice: null,
  bookDate: null,
  manualPrice: null,
  manualDate: null,
  missingCost: false,
};

/**
 * One position in a structure. `ratio` is the signed size (contracts, or shares).
 * `right` is null for stock. Both stay in lockstep with side, quantity, and instrument
 * so existing chart code can keep reading them.
 */
export type Leg = {
  readonly id: string;
  readonly instrument: Instrument;
  readonly side: Side;
  readonly quantity: number;
  readonly strike: number | null;
  readonly expiry: IsoDate | null;
  readonly entry: LegEntry;
  readonly ivOverride: number | null;
  readonly ratio: number;
  readonly right: OptionRight | null;
} & LegCost;

export function legCostOf(leg: LegCost): LegCost {
  return {
    bookPrice: leg.bookPrice,
    bookDate: leg.bookDate,
    manualPrice: leg.manualPrice,
    manualDate: leg.manualDate,
    missingCost: leg.missingCost,
  };
}

/** Hand-built cards stay small. A held book can be the whole account. */
export const LEG_CAP = 8;
export const HELD_LEG_CAP = 2_000;
/** Contracts on one line. Large enough for a real Schwab lot. */
export const OPTION_QTY_CAP = 1_000_000;

const EMPTY_ENTRY: LegEntry = { kind: "mid", price: null };

export function legPhrase(leg: Pick<Leg, "side" | "quantity" | "instrument">): string {
  const side = leg.side === "long" ? "Long" : "Short";
  const qty = Number.isInteger(leg.quantity) ? String(leg.quantity) : String(Math.round(leg.quantity * 100) / 100);
  if (leg.instrument === "stock") return `${side} ${qty} shares`;
  return `${side} ${qty}× ${leg.instrument}`;
}

export function assignLegIds(legs: readonly Leg[]): Leg[] {
  return legs.map((leg, index) => ({ ...leg, id: leg.id.length > 0 ? leg.id : `l${index}` }));
}

export function legEntry(kind: "mid" | "natural" | "limit"): LegEntry {
  return { kind, price: null };
}

export function optionLeg(input: {
  readonly right: OptionRight;
  readonly strike: number;
  readonly ratio: number;
  readonly expiry: IsoDate;
  readonly ivOverride?: number | null;
  readonly entry?: LegEntry;
  readonly id?: string;
} & Partial<LegCost>): Leg {
  const ratio = input.ratio;
  return {
    id: input.id ?? "",
    instrument: input.right === "C" ? "call" : "put",
    side: ratio > 0 ? "long" : "short",
    quantity: Math.abs(ratio),
    strike: input.strike,
    expiry: input.expiry,
    entry: input.entry ?? EMPTY_ENTRY,
    ivOverride: input.ivOverride ?? null,
    ratio,
    right: input.right,
    bookPrice: input.bookPrice ?? null,
    bookDate: input.bookDate ?? null,
    manualPrice: input.manualPrice ?? null,
    manualDate: input.manualDate ?? null,
    missingCost: input.missingCost ?? false,
  };
}

export function stockLeg(shares: number, averagePrice: number, id = ""): Leg {
  return {
    id,
    instrument: "stock",
    side: shares > 0 ? "long" : "short",
    quantity: Math.abs(shares),
    strike: null,
    expiry: null,
    entry: { kind: "limit", price: averagePrice },
    ivOverride: null,
    ratio: shares,
    right: null,
    ...NO_LEG_COST,
  };
}

/** Latest option expiry. Stock does not move it. */
export function latestOptionExpiry(legs: readonly Leg[]): IsoDate | null {
  let latest: IsoDate | null = null;
  for (const leg of legs) {
    if (leg.expiry == null) continue;
    if (latest == null || leg.expiry > latest) latest = leg.expiry;
  }
  return latest;
}

export type SyntheticShape = "long" | "short";

/** Long call + short put, or the reverse, same strike, same expiry, same quantity. */
export function syntheticShape(legs: readonly Leg[]): SyntheticShape | null {
  if (legs.length !== 2) return null;
  const call = legs.find((leg) => leg.instrument === "call");
  const put = legs.find((leg) => leg.instrument === "put");
  if (!call || !put) return null;
  if (call.strike == null || put.strike == null || call.expiry == null || put.expiry == null) return null;
  if (call.strike !== put.strike || call.expiry !== put.expiry) return null;
  if (!(call.quantity > 0) || call.quantity !== put.quantity) return null;
  if (call.side === "long" && put.side === "short") return "long";
  if (call.side === "short" && put.side === "long") return "short";
  return null;
}

/**
 * Package debit of a synthetic at parity. Dividend yield is 0.
 * Long: (S − K e^{−rT}) × 100 × contracts. Short is the negative.
 */
export function parityPackageDebit(
  spot: number,
  strike: number,
  years: number,
  contracts: number,
  shape: SyntheticShape,
  rate = MODEL_RATE,
): number {
  const perShare = spot - strike * Math.exp(-rate * Math.max(years, 0));
  const signed = shape === "long" ? perShare : -perShare;
  return Math.round(signed * 100 * contracts);
}

/** Interest on the strike, in dollars, for `contracts` synthetics. Negative: the synthetic lags the shares. */
export function syntheticFinancingGap(strike: number, years: number, contracts: number, rate = MODEL_RATE): number {
  return -strike * 100 * contracts * (1 - Math.exp(-rate * Math.max(years, 0)));
}

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

function optionalPrice(raw: Record<string, unknown>, key: string): number | null | "bad" {
  if (!(key in raw) || raw[key] == null) return null;
  const price = finite(raw[key]);
  if (price == null || !(price > 0)) return "bad";
  return price;
}

function optionalDate(raw: Record<string, unknown>, key: string): IsoDate | null | "bad" {
  if (!(key in raw) || raw[key] == null) return null;
  const date = dateOf(raw[key]);
  return date ?? "bad";
}

function readCost(raw: Record<string, unknown>): LegCost | null {
  const bookPrice = optionalPrice(raw, "bookPrice");
  const manualPrice = optionalPrice(raw, "manualPrice");
  const bookDate = optionalDate(raw, "bookDate");
  const manualDate = optionalDate(raw, "manualDate");
  if (bookPrice === "bad" || manualPrice === "bad" || bookDate === "bad" || manualDate === "bad") return null;
  if ("missingCost" in raw && raw.missingCost != null && typeof raw.missingCost !== "boolean") return null;
  return {
    bookPrice,
    bookDate,
    manualPrice,
    manualDate,
    missingCost: raw.missingCost === true,
  };
}

function parseEntry(raw: unknown, fallback: LegEntry): LegEntry | null {
  if (raw == null) return fallback;
  if (!isRecord(raw)) return null;
  if (raw.kind !== "mid" && raw.kind !== "natural" && raw.kind !== "limit") return null;
  if (raw.price == null) return { kind: raw.kind, price: null };
  const price = finite(raw.price);
  if (price == null) return null;
  return { kind: raw.kind, price };
}

/** v1 `{ right, strike, ratio }` or a v2 leg. Null when the row is garbage. */
export function parseStoredLeg(raw: unknown, structureExpiry: IsoDate, entry: LegEntry): Leg | null {
  if (!isRecord(raw)) return null;
  if (raw.instrument === "stock") {
    const quantity = finite(raw.quantity);
    const ratio = finite(raw.ratio);
    const shares = ratio ?? (quantity == null ? null : raw.side === "short" ? -quantity : quantity);
    if (shares == null || shares === 0 || Math.abs(shares) > 1_000_000) return null;
    const stored = parseEntry(raw.entry, entry);
    const price = stored?.price;
    if (price == null || !(price > 0)) return null;
    const id = typeof raw.id === "string" ? raw.id : "";
    const cost = readCost(raw);
    if (!cost) return null;
    return { ...stockLeg(shares, price, id), ...cost, entry: stored ?? { kind: "limit", price } };
  }

  if (raw.instrument === "call" || raw.instrument === "put" || raw.right === "C" || raw.right === "P") {
    const right: OptionRight | null =
      raw.instrument === "call" ? "C" : raw.instrument === "put" ? "P" : raw.right === "C" || raw.right === "P" ? raw.right : null;
    if (!right) return null;
    const strike = finite(raw.strike);
    if (strike == null || !(strike > 0)) return null;
    let ratio = finite(raw.ratio);
    if (ratio == null) {
      const quantity = finite(raw.quantity);
      if (quantity == null || quantity === 0) return null;
      ratio = raw.side === "short" ? -quantity : quantity;
    }
    if (!Number.isInteger(ratio) || ratio === 0 || Math.abs(ratio) > OPTION_QTY_CAP) return null;
    const expiry = dateOf(raw.expiry) ?? structureExpiry;
    let ivOverride: number | null = null;
    if (raw.ivOverride != null) {
      const iv = finite(raw.ivOverride);
      if (iv == null || iv < 0) return null;
      ivOverride = iv;
    }
    const legEntry = parseEntry(raw.entry, entry);
    if (!legEntry) return null;
    const cost = readCost(raw);
    if (!cost) return null;
    const id = typeof raw.id === "string" ? raw.id : "";
    return optionLeg({ right, strike, ratio, expiry, ivOverride, entry: legEntry, id, ...cost });
  }
  return null;
}

/** #182 sidecar `{ shares, averagePrice }` becomes one stock leg. */
export function stockFromSidecar(raw: unknown): Leg | null {
  if (!isRecord(raw)) return null;
  const shares = finite(raw.shares);
  const averagePrice = finite(raw.averagePrice);
  if (shares == null || shares === 0 || Math.abs(shares) > 1_000_000) return null;
  if (averagePrice == null || !(averagePrice > 0)) return null;
  return stockLeg(shares, averagePrice);
}

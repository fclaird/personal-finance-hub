import { calendarDaysBetween, type IsoDate, type OptionChain, type OptionRight } from "@/lib/optionChain/chain";
import { formatInt } from "@/lib/format";
import type { PricedStructure } from "@/lib/strategyLab/lab";
import {
  expiryPnl,
  markAt,
  packageShareDelta,
  settledShareDelta,
  type Assumptions,
} from "@/lib/strategyLab/internal/pricing";

/** Less than one share. A capped spread lands here once spot is through the short strike. */
export const FLAT_DELTA_SHARES = 1;

export const CAPPED_DELTA = "capped, delta ~0 beyond the short strike";

/**
 * Leverage = (share-equivalent delta × stock price) / dollars invested.
 * Dollars invested is the structure's net debit for the packages bought. Idle cash is not in the denominator.
 * Equivalently, the cost of the same delta in stock divided by the cost of the position.
 * Worked example: a share costs $100; 100 share-equivalent delta bought for $1,000 controls $10,000 of stock, so leverage is (100 × $100) / $1,000 = 10×. Cost per delta is $1,000 / 100 = $10.
 * The headline default is the settled delta at the short strike at expiry, times that strike. A ZEBRA is about +100 shares per package once the short call is breached. A capped spread's settled delta is about 0 beyond the short strike, so that figure also shows the delta just inside the short strike (the long leg only) and uses it so leverage is not zero.
 */
export const TARGET_LEVERAGE_HINT =
  "Leverage = (share-equivalent delta × stock price) / dollars invested. Dollars invested is the structure's net debit for the packages bought. Idle cash is not in the denominator. Equivalently, the cost of the same delta in stock divided by the cost of the position. Worked example: a share costs $100; 100 share-equivalent delta bought for $1,000 controls $10,000 of stock, so leverage is (100 × $100) / $1,000 = 10×. Cost per delta is $1,000 / 100 = $10. Headline default: settled delta at the short strike at expiry, times that strike. A ZEBRA is about +100 shares per package once the short call is breached. A capped spread is about 0 beyond the short strike, so the tile also uses the long leg only, just inside that strike. The other lines are today's delta times today's stock price, and the delta at the target price and date you pick.";

export const COST_PER_DELTA_HINT =
  "Cost per delta = dollars invested ÷ share-equivalent delta. At entry that delta is today's model delta times the package count. At the target, spot is the short call strike, or the price you typed. On an expiry date the delta is the settled share count: a ZEBRA is +100 shares per package just through the short strike, and a capped spread is about 0 beyond it. For that capped case the cost also uses the long leg only, just inside the short strike. Worked example: $1,000 invested for 100 delta-shares is $10 per delta, and leverage against a $100 stock is 10×.";

export type LeverageBasis = "expiryShort" | "entry" | "scenario";

export const DEFAULT_LEVERAGE_BASIS: LeverageBasis = "expiryShort";

export const LEVERAGE_BASES: readonly { readonly id: LeverageBasis; readonly label: string }[] = [
  { id: "expiryShort", label: "Short strike at expiry" },
  { id: "entry", label: "At entry" },
  { id: "scenario", label: "Target price and date" },
];

export type LeverageQuote = {
  readonly basis: LeverageBasis;
  readonly title: string;
  /** Share-equivalent delta plugged into the ratio. For a capped spread at the short strike this is the long leg only. */
  readonly delta: number | null;
  readonly price: number | null;
  readonly leverage: number | null;
  readonly note: string;
  /** Settled delta just through the short strike is about 0. */
  readonly cappedBeyond: boolean;
  readonly beyondDelta: number | null;
};

export type TargetSource = "short-call" | "override";

export type TargetRead = {
  readonly target: number;
  readonly source: TargetSource;
  readonly settled: boolean;
  readonly packageDelta: number | null;
  readonly positionDelta: number | null;
  readonly capped: boolean;
  /** Long-leg-only share count at the short strike at expiry, when the beyond-strike delta is about 0. */
  readonly insidePositionDelta: number | null;
  readonly costPerDeltaEntry: number | null;
  readonly costPerDeltaTarget: number | null;
  readonly costPerInsideDelta: number | null;
  /** Raw (delta at the target × target price) / invested. Blank when that delta is about 0. */
  readonly leverageAtTarget: number | null;
  /** Same ratio using the long leg only, so a capped spread still has a figure. */
  readonly insideLeverage: number | null;
  readonly pnl: number | null;
  readonly multiple: number | null;
};

type Leg = { readonly right: OptionRight; readonly strike: number; readonly ratio: number };

/** (share-equivalent delta × stock price) / dollars invested. Blank when the delta is under one share. */
export function positionLeverage(deltaShares: number, stockPrice: number, invested: number): number | null {
  if (!(invested > 0) || !Number.isFinite(deltaShares) || !Number.isFinite(stockPrice)) return null;
  if (Math.abs(deltaShares) < FLAT_DELTA_SHARES) return null;
  return (deltaShares * stockPrice) / invested;
}

/** Highest short call. That is the strike a debit spread or ZEBRA has to clear. */
export function shortCallStrike(legs: readonly Leg[]): number | null {
  const shorts = legs.filter((leg) => leg.right === "C" && leg.ratio < 0).map((leg) => leg.strike);
  if (shorts.length === 0) return null;
  return Math.max(...shorts);
}

export function dollarsPerDelta(amount: number): string {
  return `$${formatInt(Math.round(amount))}`;
}

export function formatLeverage(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(2)}×`;
}

export function costPerDeltaLine(read: TargetRead): string {
  const entry = read.costPerDeltaEntry == null ? "—" : `${dollarsPerDelta(read.costPerDeltaEntry)} per delta at entry`;
  const where = read.source === "short-call" ? "at the short strike" : "at the target";
  if (read.capped || read.costPerDeltaTarget == null) {
    const inside =
      read.costPerInsideDelta == null
        ? ""
        : `; ${dollarsPerDelta(read.costPerInsideDelta)} per delta just inside the short strike (long leg only)`;
    return `${entry}, ${CAPPED_DELTA}${inside}`;
  }
  return `${entry}, ${dollarsPerDelta(read.costPerDeltaTarget)} per delta ${where}`;
}

function perDelta(invested: number, positionDelta: number | null): number | null {
  if (positionDelta == null || !(invested > 0) || !(Math.abs(positionDelta) >= FLAT_DELTA_SHARES)) return null;
  return invested / positionDelta;
}

export function readTarget(input: {
  row: PricedStructure;
  assumptions: Assumptions;
  chain: OptionChain;
  date: IsoDate;
  /** Typed spot. Null uses the short call strike. */
  targetSpot: number | null;
}): TargetRead | null {
  const { row, assumptions, chain, date } = input;
  if (row.sizing.status === "needsCapitalOverride") return null;
  const short = shortCallStrike(row.legs);
  const override = input.targetSpot != null && input.targetSpot > 0 ? input.targetSpot : null;
  const target = override ?? short;
  if (target == null) return null;
  const settled = calendarDaysBetween(date, row.spec.expiry) <= 0;
  const years = settled ? 0 : calendarDaysBetween(date, row.spec.expiry) / 365;
  const packageDelta = packageShareDelta(row.legs, assumptions, target, years);
  const packages = row.sizing.packages;
  const invested = row.sizing.invested;
  const positionDelta = packageDelta == null ? null : packageDelta * packages;
  const capped = packageDelta != null && Math.abs(packageDelta) < FLAT_DELTA_SHARES;
  const atShortStrike = short != null && Math.abs(target - short) <= 1e-6;
  const insidePackage =
    settled && capped && atShortStrike ? settledShareDelta(row.legs.filter((leg) => leg.ratio > 0), target) : null;
  const insideUsable = insidePackage != null && Math.abs(insidePackage) >= FLAT_DELTA_SHARES;
  const insidePositionDelta = insideUsable ? insidePackage * packages : null;
  const entryDelta = row.greeks == null ? null : row.greeks.delta * packages;
  const mark = settled ? expiryPnl(row.legs, row.debit, target) : markValue(chain, row, assumptions, target, date);
  const pnl = mark == null ? null : mark * packages;
  const multiple = pnl == null || !(invested > 0) ? null : (invested + pnl) / invested;
  const leverageAtTarget =
    capped || positionDelta == null ? null : positionLeverage(positionDelta, target, invested);
  const insideLeverage = insidePositionDelta == null ? null : positionLeverage(insidePositionDelta, target, invested);
  return {
    target,
    source: override == null ? "short-call" : "override",
    settled,
    packageDelta,
    positionDelta,
    capped,
    insidePositionDelta,
    costPerDeltaEntry: perDelta(invested, entryDelta),
    costPerDeltaTarget: capped ? null : perDelta(invested, positionDelta),
    costPerInsideDelta: perDelta(invested, insidePositionDelta),
    leverageAtTarget,
    insideLeverage,
    pnl,
    multiple,
  };
}

function expiryShortQuote(row: PricedStructure, invested: number, packages: number): LeverageQuote {
  const strike = shortCallStrike(row.legs);
  if (strike == null) {
    return {
      basis: "expiryShort",
      title: "Short strike at expiry",
      delta: null,
      price: null,
      leverage: null,
      note: "This structure has no short call.",
      cappedBeyond: false,
      beyondDelta: null,
    };
  }
  const beyondPkg = settledShareDelta(row.legs, strike);
  const beyond = beyondPkg * packages;
  const capped = Math.abs(beyondPkg) < FLAT_DELTA_SHARES;
  const insidePkg = settledShareDelta(
    row.legs.filter((leg) => leg.ratio > 0),
    strike,
  );
  const useInside = capped && Math.abs(insidePkg) >= FLAT_DELTA_SHARES;
  const delta = (useInside ? insidePkg : beyondPkg) * packages;
  return {
    basis: "expiryShort",
    title: "Short strike at expiry",
    delta,
    price: strike,
    leverage: useInside || !capped ? positionLeverage(delta, strike, invested) : null,
    note: useInside
      ? "Long leg only, just inside the short strike at expiry. Beyond the short strike the spread is capped and delta is about 0."
      : capped
        ? "Settled delta just through the short strike is about 0."
        : "Settled delta just through the short strike at expiry. A ZEBRA is about +100 shares per package once that short call is breached.",
    cappedBeyond: capped,
    beyondDelta: beyond,
  };
}

function entryQuote(row: PricedStructure, spot: number, invested: number, packages: number): LeverageQuote {
  const delta = row.greeks == null ? null : row.greeks.delta * packages;
  return {
    basis: "entry",
    title: "At entry",
    delta,
    price: spot,
    leverage: delta == null ? null : positionLeverage(delta, spot, invested),
    note: "Today's model delta times today's stock price, divided by dollars invested.",
    cappedBeyond: false,
    beyondDelta: null,
  };
}

function scenarioQuote(read: TargetRead | null): LeverageQuote {
  if (read == null) {
    return {
      basis: "scenario",
      title: "Target price and date",
      delta: null,
      price: null,
      leverage: null,
      note: "Uses the horizon date and the target price. An empty price means the short strike.",
      cappedBeyond: false,
      beyondDelta: null,
    };
  }
  const useInside = read.insidePositionDelta != null && read.insideLeverage != null;
  const when = read.settled ? "at expiry" : "on the selected date";
  return {
    basis: "scenario",
    title: "Target price and date",
    delta: useInside ? read.insidePositionDelta : read.positionDelta,
    price: read.target,
    leverage: useInside ? read.insideLeverage : read.leverageAtTarget,
    note: useInside
      ? `Long leg only, just inside the short strike ${when}. Beyond the short strike the spread is capped and delta is about 0.`
      : read.capped
        ? `At this price ${when} the delta is about 0, so leverage is left blank. The spread is capped beyond the short strike.`
        : `Delta at this price ${when}, times that price, divided by dollars invested.`,
    cappedBeyond: read.capped,
    beyondDelta: read.capped ? read.positionDelta : null,
  };
}

/** Three leverage readings. Each divides by dollars invested, never by capital that still includes idle cash. */
export function leverageQuotes(
  row: PricedStructure,
  spot: number,
  scenario: TargetRead | null,
): readonly LeverageQuote[] | null {
  if (row.sizing.status === "needsCapitalOverride") return null;
  const { invested, packages } = row.sizing;
  return [expiryShortQuote(row, invested, packages), entryQuote(row, spot, invested, packages), scenarioQuote(scenario)];
}

export function leverageValue(quote: LeverageQuote): string {
  if (quote.leverage != null) return formatLeverage(quote.leverage);
  if (quote.cappedBeyond) return CAPPED_DELTA;
  return "—";
}

function markValue(
  chain: OptionChain,
  row: PricedStructure,
  assumptions: Assumptions,
  spot: number,
  date: IsoDate,
): number | null {
  const value = markAt(chain, row.spec.expiry, row.legs, assumptions, spot, date);
  if (value == null) return null;
  return value - row.debit;
}

/** Expiry date for the "Expiry" horizon choice: the structure's own expiry. */
export function expiryDate(row: PricedStructure): IsoDate {
  return row.spec.expiry;
}

export function describeShareDelta(delta: number | null, capped: boolean): string {
  if (capped) return CAPPED_DELTA;
  if (delta == null) return "—";
  const rounded = Math.round(delta * 10) / 10;
  const body = Number.isInteger(rounded) ? formatInt(rounded) : rounded.toFixed(1);
  return `${rounded > 0 ? "+" : ""}${body}`;
}

/** Share count for the tile. A capped spread leads with the long-leg delta just inside the short strike. */
export function deltaLabel(read: TargetRead): string {
  if (read.insidePositionDelta != null) {
    return `${describeShareDelta(read.insidePositionDelta, false)} just inside; ${CAPPED_DELTA}`;
  }
  return describeShareDelta(read.positionDelta, read.capped);
}

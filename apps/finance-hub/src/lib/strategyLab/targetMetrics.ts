import { calendarDaysBetween, type IsoDate, type OptionChain, type OptionRight } from "@/lib/optionChain/chain";
import { formatInt } from "@/lib/format";
import type { PricedStructure } from "@/lib/strategyLab/lab";
import {
  expiryPnl,
  markAt,
  packageShareDelta,
  type Assumptions,
} from "@/lib/strategyLab/internal/pricing";

/** Less than one share. A capped spread lands here once spot is through the short strike. */
export const FLAT_DELTA_SHARES = 1;

export const CAPPED_DELTA = "capped, delta ~0 beyond the short strike";

export const COST_PER_DELTA_HINT =
  "Cost per delta = dollars invested ÷ share-equivalent delta. That delta is the model delta of one package times the package count. At entry, spot is today's price. At the target, spot is the short call strike, or the target price you typed. On an expiry date the delta is the settled share count just through that price: a ZEBRA is +100 shares per package, and a capped spread is about 0.";

export const TARGET_LEVERAGE_HINT =
  "Leverage if target reached = delta at the target × target price × packages, divided by dollars invested. At entry uses today's delta and today's spot. When the delta is about 0, the spread is capped and that ratio is left blank.";

export type TargetSource = "short-call" | "override";

export type TargetRead = {
  readonly target: number;
  readonly source: TargetSource;
  readonly settled: boolean;
  readonly packageDelta: number | null;
  readonly positionDelta: number | null;
  readonly capped: boolean;
  readonly costPerDeltaEntry: number | null;
  readonly costPerDeltaTarget: number | null;
  readonly leverageAtTarget: number | null;
  readonly pnl: number | null;
  readonly multiple: number | null;
};

type Leg = { readonly right: OptionRight; readonly strike: number; readonly ratio: number };

/** Highest short call. That is the strike a debit spread or ZEBRA has to clear. */
export function shortCallStrike(legs: readonly Leg[]): number | null {
  const shorts = legs.filter((leg) => leg.right === "C" && leg.ratio < 0).map((leg) => leg.strike);
  if (shorts.length === 0) return null;
  return Math.max(...shorts);
}

export function dollarsPerDelta(amount: number): string {
  return `$${formatInt(Math.round(amount))}`;
}

export function costPerDeltaLine(read: TargetRead): string {
  const entry = read.costPerDeltaEntry == null ? "—" : `${dollarsPerDelta(read.costPerDeltaEntry)} per delta at entry`;
  const where = read.source === "short-call" ? "at the short strike" : "at the target";
  const target =
    read.capped || read.costPerDeltaTarget == null ? CAPPED_DELTA : `${dollarsPerDelta(read.costPerDeltaTarget)} per delta ${where}`;
  return `${entry}, ${target}`;
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
  const entryDelta = row.greeks == null ? null : row.greeks.delta * packages;
  const mark = settled ? expiryPnl(row.legs, row.debit, target) : markValue(chain, row, assumptions, target, date);
  const pnl = mark == null ? null : mark * packages;
  const multiple = pnl == null || !(invested > 0) ? null : (invested + pnl) / invested;
  const leverageAtTarget =
    capped || positionDelta == null || !(invested > 0) ? null : (positionDelta * target) / invested;
  return {
    target,
    source: override == null ? "short-call" : "override",
    settled,
    packageDelta,
    positionDelta,
    capped,
    costPerDeltaEntry: perDelta(invested, entryDelta),
    costPerDeltaTarget: capped ? null : perDelta(invested, positionDelta),
    leverageAtTarget,
    pnl,
    multiple,
  };
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


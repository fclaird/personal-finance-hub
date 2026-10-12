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
 * Leverage now is option omega: today's model delta, in shares, times the stock price, divided by the debit paid for the packages.
 * Idle cash is not in the denominator. A credit has no debit, so the ratio is left blank.
 * Worked example: 100 shares of delta on a $100 stock, bought for a $1,000 debit, is (100 × $100) / $1,000 = 10×.
 */
export const LEVERAGE_NOW_HINT =
  "Leverage now is how hard the position moves with the stock today, per dollar you paid. It is today's model delta, in shares, times the stock price, divided by the debit for the packages. Idle cash is not included. A credit has no debit, so this is left blank. Example: 100 shares of delta on a $100 stock, bought for a $1,000 debit, is 10×.";

export const PEAK_LEVERAGE_HINT =
  "Peak leverage is the highest value of that same ratio anywhere on today's price curve, and the stock price where it happens. The curve uses today's date, with time still left until expiry. It does not use the settled share count at expiration, and it does not divide a future share count by today's debit.";

export const MAX_PROFIT_HINT =
  "Max profit is the most the structure can make at expiry, divided by the debit you paid. A long call has no cap, so this reads Uncapped.";

export const RETURN_ON_DEBIT_HINT =
  "Return on debit is the profit or loss at the target price and date, divided by the debit you paid. A loss is a negative multiple.";

export const DELTA_AT_SHORT_HINT =
  "This is a share count, not leverage. It is the model delta if the stock is at the short strike on the date you picked. On an expiry date a capped spread is about 0 shares once that strike is reached, and the line also shows the long-leg share count just inside the strike. Nothing here is divided by the debit.";

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
  readonly pnl: number | null;
  /** Position value at the target divided by dollars invested. Not a leverage figure. */
  readonly multiple: number | null;
};

export type TileMetrics = {
  /** Today's model delta times spot, divided by the debit. The old "at entry" omega. */
  readonly leverageNow: number | null;
  readonly peakLeverage: number | null;
  readonly peakSpot: number | null;
  /** Max profit dollars divided by debit dollars. Null when the gain is uncapped or there is no debit. */
  readonly maxProfitMultiple: number | null;
  readonly maxProfitUnbounded: boolean;
  /** P&L at the target price and date, divided by the debit. */
  readonly returnOnDebit: number | null;
};

type Leg = { readonly right: OptionRight | null; readonly strike: number | null; readonly ratio: number };

/** Option omega: (share-equivalent delta × stock price) / debit dollars. Blank when the debit is not positive or the delta is under one share. */
export function positionLeverage(deltaShares: number, stockPrice: number, invested: number): number | null {
  if (!(invested > 0) || !Number.isFinite(deltaShares) || !Number.isFinite(stockPrice)) return null;
  if (Math.abs(deltaShares) < FLAT_DELTA_SHARES) return null;
  return (deltaShares * stockPrice) / invested;
}

/** Highest short call. That is the strike a debit spread or ZEBRA has to clear. */
export function shortCallStrike(legs: readonly Leg[]): number | null {
  const shorts = legs
    .filter((leg): leg is Leg & { strike: number } => leg.right === "C" && leg.ratio < 0 && leg.strike != null)
    .map((leg) => leg.strike);
  if (shorts.length === 0) return null;
  return Math.max(...shorts);
}

export function formatLeverage(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(2)}×`;
}

export function formatPeakLeverage(omega: number | null, spot: number | null): string {
  if (omega == null || spot == null || !Number.isFinite(omega) || !Number.isFinite(spot)) return "—";
  return `${formatLeverage(omega)} at $${spot.toFixed(2)}`;
}

export function formatMaxProfitMultiple(metrics: Pick<TileMetrics, "maxProfitUnbounded" | "maxProfitMultiple"> | null): string {
  if (metrics == null) return "—";
  if (metrics.maxProfitUnbounded) return "Uncapped";
  return formatLeverage(metrics.maxProfitMultiple);
}

/**
 * Highest omega on today's price curve. Each point is model delta at that price, times that price, divided by the debit.
 * The scan uses the years still left until expiry on the entry date.
 */
export function peakOmega(input: {
  readonly legs: Parameters<typeof packageShareDelta>[0];
  readonly assumptions: Assumptions;
  readonly packages: number;
  readonly invested: number;
  readonly spots: readonly number[];
  readonly years: number;
}): { readonly omega: number; readonly spot: number } | null {
  let best: { omega: number; spot: number } | null = null;
  for (const spot of input.spots) {
    if (!(spot > 0)) continue;
    const pkg = packageShareDelta(input.legs, input.assumptions, spot, input.years);
    if (pkg == null) continue;
    const omega = positionLeverage(pkg * input.packages, spot, input.invested);
    if (omega == null) continue;
    if (best == null || omega > best.omega) best = { omega, spot };
  }
  return best;
}

/** Debit dollars for the sized packages. A credit or a zero debit has none. */
export function debitDollars(row: PricedStructure): number | null {
  if (row.sizing.status === "needsCapitalOverride") return null;
  if (!(row.debit > 0) || !(row.sizing.packages > 0)) return null;
  return row.debit * row.sizing.packages;
}

export function tileMetrics(input: {
  row: PricedStructure;
  assumptions: Assumptions;
  spot: number;
  spots: readonly number[];
  entryDate: IsoDate;
  target: TargetRead | null;
}): TileMetrics | null {
  const { row } = input;
  if (row.sizing.status === "needsCapitalOverride") return null;
  const { packages } = row.sizing;
  const debit = debitDollars(row);
  const deltaNow = row.greeks == null ? null : row.greeks.delta * packages;
  const leverageNow = debit == null || deltaNow == null ? null : positionLeverage(deltaNow, input.spot, debit);
  const days = calendarDaysBetween(input.entryDate, row.spec.expiry);
  const years = days <= 0 ? 0 : days / 365;
  const spots = input.spots.includes(input.spot) ? input.spots : [input.spot, ...input.spots];
  const peak =
    debit == null
      ? null
      : peakOmega({
          legs: row.legs,
          assumptions: input.assumptions,
          packages,
          invested: debit,
          spots,
          years,
        });
  const maxProfitUnbounded = row.risk.maxGain === "unbounded";
  const maxProfitMultiple =
    maxProfitUnbounded || debit == null || typeof row.risk.maxGain !== "number" ? null : (row.risk.maxGain * packages) / debit;
  const returnOnDebit = input.target?.pnl == null || debit == null ? null : input.target.pnl / debit;
  return {
    leverageNow,
    peakLeverage: peak?.omega ?? null,
    peakSpot: peak?.spot ?? null,
    maxProfitMultiple,
    maxProfitUnbounded,
    returnOnDebit,
  };
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
  const mark = settled ? expiryPnl(row.legs, row.debit, target) : markValue(chain, row, assumptions, target, date);
  const pnl = mark == null ? null : mark * packages;
  const multiple = pnl == null || !(invested > 0) ? null : (invested + pnl) / invested;
  return {
    target,
    source: override == null ? "short-call" : "override",
    settled,
    packageDelta,
    positionDelta,
    capped,
    insidePositionDelta,
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

/** Share count for the tile. A capped spread leads with the long-leg delta just inside the short strike. */
export function deltaLabel(read: TargetRead): string {
  if (read.insidePositionDelta != null) {
    return `${describeShareDelta(read.insidePositionDelta, false)} just inside; ${CAPPED_DELTA}`;
  }
  return describeShareDelta(read.positionDelta, read.capped);
}

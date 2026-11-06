import { calendarDaysBetween, type IsoDate } from "@/lib/optionChain/chain";
import type { Leg } from "@/lib/strategyLab/legs";

export type CostSource = "manual" | "book" | "mark";

export type ResolvedCost = {
  readonly price: number | null;
  readonly source: CostSource;
  readonly date: IsoDate | null;
};

function positive(price: number | null): price is number {
  return price != null && price > 0;
}

/** Manual price, then the book price, then the live mark. A typed date wins over the fill date. */
export function resolveLegCost(leg: Leg, mark: number | null): ResolvedCost {
  const date = leg.manualDate ?? leg.bookDate ?? null;
  if (positive(leg.manualPrice)) return { price: leg.manualPrice, source: "manual", date };
  if (positive(leg.bookPrice)) return { price: leg.bookPrice, source: "book", date };
  return { price: positive(mark) ? mark : null, source: "mark", date: leg.manualDate };
}

export function packageUsesEntryCost(legs: readonly Leg[]): boolean {
  return legs.some((leg) => positive(leg.manualPrice) || positive(leg.bookPrice));
}

/** Whole-package debit from resolved per-leg prices. Null when a leg has no price at all. */
export function entryPackageDebit(
  legs: readonly Leg[],
  marks: readonly (number | null)[],
): { readonly debit: number; readonly optionPerShare: number } | null {
  let dollars = 0;
  let optionPerShare = 0;
  for (let index = 0; index < legs.length; index++) {
    const leg = legs[index]!;
    const resolved = resolveLegCost(leg, marks[index] ?? null);
    if (resolved.price == null) return null;
    const multiplier = leg.instrument === "stock" ? 1 : 100;
    dollars += leg.ratio * resolved.price * multiplier;
    if (leg.instrument !== "stock") optionPerShare += leg.ratio * resolved.price;
  }
  return { debit: Math.round(dollars), optionPerShare };
}

/** Calendar days from the earliest fill or override to the chain's trade date. */
export function daysHeldFromLegs(legs: readonly Leg[], tradeDate: IsoDate): number | null {
  let earliest: IsoDate | null = null;
  for (const leg of legs) {
    const date = leg.manualDate ?? leg.bookDate ?? null;
    if (!date) continue;
    if (earliest == null || date < earliest) earliest = date;
  }
  if (!earliest) return null;
  return Math.max(0, calendarDaysBetween(earliest, tradeDate));
}

export function legMissingBookCost(leg: Leg): boolean {
  return leg.missingCost && !positive(leg.manualPrice) && !positive(leg.bookPrice);
}

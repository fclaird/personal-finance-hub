import type { FlavorId } from "@/lib/flavor";
import { accountsInFlavorWhereSql } from "@/lib/flavors/accounts";
import { notPosterityWhereSql } from "@/lib/posterity";

/** Account predicate for strategy TRADE listings (posterity + flavor). */
export function strategyTradesAccountWhereSql(flavor: FlavorId, alias = "a"): string {
  return `${notPosterityWhereSql(alias)} AND ${accountsInFlavorWhereSql(flavor, alias)}`;
}

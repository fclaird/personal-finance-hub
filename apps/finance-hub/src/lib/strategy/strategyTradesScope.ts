import type { FlavorId } from "@/lib/flavor";
import { accountsInFlavorAndPosterityWhereSql } from "@/lib/flavors/accounts";

/** Account predicate for strategy TRADE listings (posterity + flavor). */
export function strategyTradesAccountWhereSql(flavor: FlavorId, alias = "a"): string {
  return accountsInFlavorAndPosterityWhereSql(flavor, alias);
}

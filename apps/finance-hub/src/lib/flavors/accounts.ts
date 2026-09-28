import type { FlavorId } from "@/lib/flavor";
import { getFlavorConfig, PEYTON_ACCOUNT_ID, RORIE_ACCOUNT_ID } from "@/lib/flavors/registry";
import { isPosterityAccountId, notPosterityWhereSql, POSTERITY_ACCOUNT_IDS } from "@/lib/posterity";

export { PEYTON_ACCOUNT_ID, RORIE_ACCOUNT_ID };

export function isAccountInFlavor(flavor: FlavorId, accountId: string | null | undefined): boolean {
  if (!accountId) return false;
  const cfg = getFlavorConfig(flavor).accountFilter;
  if (cfg.kind === "include") return cfg.ids.includes(accountId);
  return !cfg.ids.includes(accountId);
}

export function accountsInFlavorWhereSql(flavor: FlavorId, alias = "a"): string {
  const cfg = getFlavorConfig(flavor).accountFilter;
  if (cfg.kind === "include") {
    if (cfg.ids.length === 0) return "0";
    const list = cfg.ids.map((id) => `'${id}'`).join(", ");
    return `${alias}.id IN (${list})`;
  }
  if (cfg.ids.length === 0) return "1";
  const list = cfg.ids.map((id) => `'${id}'`).join(", ");
  return `${alias}.id NOT IN (${list})`;
}

/** True when this flavor's include list contains a posterity Schwab account. */
export function flavorIncludesPosterityAccount(flavor: FlavorId): boolean {
  const cfg = getFlavorConfig(flavor).accountFilter;
  if (cfg.kind !== "include") return false;
  return cfg.ids.some((id) => isPosterityAccountId(id));
}

/**
 * Drop posterity accounts from a flavor that does not own them.
 * A flavor whose include list is those accounts (Peyton) keeps them.
 */
export function posterityExclusionForFlavorSql(flavor: FlavorId, alias = "a"): string | null {
  if (!flavorIncludesPosterityAccount(flavor)) return notPosterityWhereSql(alias);
  const cfg = getFlavorConfig(flavor).accountFilter;
  if (cfg.kind !== "include") return notPosterityWhereSql(alias);
  const hidden = POSTERITY_ACCOUNT_IDS.filter((id) => !cfg.ids.includes(id));
  if (hidden.length === 0) return null;
  const list = hidden.map((id) => `'${id}'`).join(", ");
  return `${alias}.id NOT IN (${list})`;
}

/** Flavor membership plus posterity exclusion. Main and Rorie row sets match the pre-Peyton predicates. */
export function accountsInFlavorAndPosterityWhereSql(flavor: FlavorId, alias = "a"): string {
  const flavorSql = accountsInFlavorWhereSql(flavor, alias);
  const posteritySql = posterityExclusionForFlavorSql(flavor, alias);
  return posteritySql ? `${posteritySql} AND ${flavorSql}` : flavorSql;
}

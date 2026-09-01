import type { FlavorId } from "@/lib/flavor";
import { getFlavorConfig, RORIE_ACCOUNT_ID } from "@/lib/flavors/registry";

export { RORIE_ACCOUNT_ID };

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

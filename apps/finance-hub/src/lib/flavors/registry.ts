import type { FlavorId } from "@/lib/flavor";

export type SidebarNavItem = { href: string; label: string; prefix?: string };

/** Schwab account scoped to the rorie flavor (formerly Aurora Finance Hub). */
export const RORIE_ACCOUNT_ID = "schwab_94558855";

export type FlavorConfig = {
  id: FlavorId;
  label: string;
  nav: SidebarNavItem[];
  accountFilter: { kind: "exclude"; ids: string[] } | { kind: "include"; ids: string[] };
  features: {
    plaid: boolean;
    earnings: boolean;
    strategies: boolean;
    posterity: boolean;
  };
};

const MAIN_NAV: SidebarNavItem[] = [
  { href: "/terminal", label: "Terminal" },
  { href: "/positions", label: "Positions" },
  { href: "/strategies/all", label: "Option Strategies", prefix: "/strategies" },
  { href: "/allocation", label: "Allocation" },
  { href: "/diversification", label: "Diversification" },
  { href: "/earnings", label: "Earnings" },
  { href: "/performance", label: "Performance" },
  { href: "/reports", label: "Reports", prefix: "/reports" },
  { href: "/dividends", label: "Dividends" },
  { href: "/rebalancing", label: "Rebalancing" },
  { href: "/alerts", label: "Alerts" },
  { href: "/posterity", label: "Posterity" },
];

const RORIE_NAV: SidebarNavItem[] = [
  { href: "/terminal", label: "Terminal" },
  { href: "/positions", label: "Positions" },
  { href: "/allocation", label: "Allocation" },
  { href: "/diversification", label: "Diversification" },
  { href: "/performance", label: "Performance" },
  { href: "/reports", label: "Reports", prefix: "/reports" },
  { href: "/dividends", label: "Dividends" },
  { href: "/rebalancing", label: "Rebalancing" },
  { href: "/alerts", label: "Alerts" },
  { href: "/connections", label: "Connections" },
];

export const FLAVOR_REGISTRY: Record<FlavorId, FlavorConfig> = {
  main: {
    id: "main",
    label: "Main",
    nav: MAIN_NAV,
    accountFilter: { kind: "exclude", ids: [RORIE_ACCOUNT_ID] },
    features: { plaid: true, earnings: true, strategies: true, posterity: true },
  },
  rorie: {
    id: "rorie",
    label: "Rorie",
    nav: RORIE_NAV,
    accountFilter: { kind: "include", ids: [RORIE_ACCOUNT_ID] },
    features: { plaid: false, earnings: false, strategies: false, posterity: false },
  },
};

export function getFlavorConfig(id: FlavorId): FlavorConfig {
  return FLAVOR_REGISTRY[id];
}

export function navForFlavor(id: FlavorId): SidebarNavItem[] {
  return getFlavorConfig(id).nav;
}

export function defaultNavHref(id: FlavorId): string {
  return navForFlavor(id)[0]?.href ?? "/terminal";
}

export function sidebarNavOrderStorageKey(id: FlavorId): string {
  return `fh.sidebar.nav.order.v1.${id}`;
}

export function isPathAllowedForFlavor(pathname: string, flavor: FlavorId): boolean {
  if (pathname === "/connections" || pathname.startsWith("/connections/")) return true;
  const nav = navForFlavor(flavor);
  for (const item of nav) {
    if (item.prefix) {
      if (pathname.startsWith(item.prefix)) return true;
    } else if (pathname === item.href || pathname.startsWith(`${item.href}/`)) {
      return true;
    }
  }
  return false;
}

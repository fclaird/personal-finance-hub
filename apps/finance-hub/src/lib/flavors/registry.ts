import type { FlavorId } from "@/lib/flavor";
import { POSTERITY_ACCOUNT_IDS } from "@/lib/posterity";

export type SidebarNavItem = { href: string; label: string; prefix?: string };

export type FlavorAccent = {
  /** Sidebar flavor chip. */
  badgeClass: string;
  /** Connections page pill when this flavor is selected. */
  pillActiveClass: string;
};

/** Schwab account scoped to the rorie flavor (formerly Aurora Finance Hub). */
export const RORIE_ACCOUNT_ID = "schwab_94558855";

/** Schwab account scoped to the peyton flavor (also shown on Main's Posterity tab). */
export const PEYTON_ACCOUNT_ID = POSTERITY_ACCOUNT_IDS[0];

/**
 * Dedicated flavors and the Schwab accounts they own.
 * Main is every other account: its filter excludes this whole list.
 */
export const DEDICATED_FLAVOR_ACCOUNTS = {
  rorie: [RORIE_ACCOUNT_ID],
  peyton: [...POSTERITY_ACCOUNT_IDS],
} as const satisfies Record<Exclude<FlavorId, "main">, readonly string[]>;

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
  accent: FlavorAccent;
};

const MAIN_NAV: SidebarNavItem[] = [
  { href: "/terminal", label: "Terminal" },
  { href: "/positions", label: "Positions" },
  { href: "/strategies/situations", label: "Option Strategies", prefix: "/strategies" },
  { href: "/allocation", label: "Allocation" },
  { href: "/diversification", label: "Diversification" },
  { href: "/earnings", label: "Earnings" },
  { href: "/performance", label: "Performance" },
  { href: "/reports", label: "Reports (realized gain/loss)", prefix: "/reports" },
  { href: "/dividends", label: "Dividends" },
  { href: "/rebalancing", label: "Rebalancing" },
  { href: "/alerts", label: "Alerts" },
  { href: "/posterity", label: "Posterity" },
];

/** Reduced Aurora-style sidebar shared by dedicated single-account flavors. */
const DEDICATED_NAV: SidebarNavItem[] = [
  { href: "/terminal", label: "Terminal" },
  { href: "/positions", label: "Positions" },
  { href: "/allocation", label: "Allocation" },
  { href: "/diversification", label: "Diversification" },
  { href: "/performance", label: "Performance" },
  { href: "/reports", label: "Reports (realized gain/loss)", prefix: "/reports" },
  { href: "/dividends", label: "Dividends" },
  { href: "/rebalancing", label: "Rebalancing" },
  { href: "/alerts", label: "Alerts" },
  { href: "/connections", label: "Connections" },
];

const DEDICATED_FEATURES: FlavorConfig["features"] = {
  plaid: false,
  earnings: false,
  strategies: false,
  posterity: false,
};

/**
 * Chip colors. Main keeps the original zinc chip.
 * Dedicated flavors use the same chip shape with a distinct hue: Rorie sky, Peyton fuchsia.
 */
const MAIN_ACCENT: FlavorAccent = {
  badgeClass: "bg-zinc-100 text-zinc-700 dark:bg-white/10 dark:text-zinc-300",
  pillActiveClass: "bg-zinc-950 text-white dark:bg-white dark:text-black",
};

const RORIE_ACCENT: FlavorAccent = {
  badgeClass: "bg-sky-100 text-sky-950 dark:bg-sky-500/20 dark:text-sky-100",
  pillActiveClass: "bg-sky-800 text-white dark:bg-sky-300 dark:text-sky-950",
};

const PEYTON_ACCENT: FlavorAccent = {
  badgeClass: "bg-fuchsia-100 text-fuchsia-950 dark:bg-fuchsia-500/20 dark:text-fuchsia-100",
  pillActiveClass: "bg-fuchsia-800 text-white dark:bg-fuchsia-300 dark:text-fuchsia-950",
};

const MAIN_EXCLUDED_ACCOUNT_IDS = Object.values(DEDICATED_FLAVOR_ACCOUNTS).flat();

export const FLAVOR_REGISTRY: Record<FlavorId, FlavorConfig> = {
  main: {
    id: "main",
    label: "Main",
    nav: MAIN_NAV,
    accountFilter: { kind: "exclude", ids: [...MAIN_EXCLUDED_ACCOUNT_IDS] },
    features: { plaid: true, earnings: true, strategies: true, posterity: true },
    accent: MAIN_ACCENT,
  },
  rorie: {
    id: "rorie",
    label: "Rorie",
    nav: DEDICATED_NAV,
    accountFilter: { kind: "include", ids: [...DEDICATED_FLAVOR_ACCOUNTS.rorie] },
    features: DEDICATED_FEATURES,
    accent: RORIE_ACCENT,
  },
  peyton: {
    id: "peyton",
    label: "Peyton",
    nav: DEDICATED_NAV,
    accountFilter: { kind: "include", ids: [...DEDICATED_FLAVOR_ACCOUNTS.peyton] },
    features: DEDICATED_FEATURES,
    accent: PEYTON_ACCENT,
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

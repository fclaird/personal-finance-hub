import { mergeWithDefaults } from "@/lib/usePersistedOrder";

export type SidebarNavItem = { href: string; label: string; prefix?: string };

export const NAV: SidebarNavItem[] = [
  { href: "/terminal", label: "Terminal" },
  { href: "/positions", label: "Positions" },
  { href: "/strategies/all", label: "Option Strategies", prefix: "/strategies" },
  { href: "/allocation", label: "Allocation" },
  { href: "/diversification", label: "Diversification" },
  { href: "/earnings", label: "Earnings" },
  { href: "/performance", label: "Performance" },
  { href: "/dividends", label: "Dividends" },
  { href: "/rebalancing", label: "Rebalancing" },
  { href: "/alerts", label: "Alerts" },
  { href: "/posterity", label: "Posterity" },
];

export const SIDEBAR_NAV_ORDER_STORAGE_KEY = "fh.sidebar.nav.order.v1";
export const SIDEBAR_COLLAPSED_STORAGE_KEY = "fh.sidebar.collapsed.v1";

export const DEFAULT_SIDEBAR_NAV_ORDER = NAV.map((item) => item.href);

export function readSidebarNavOrderFromStorage(): string[] {
  if (typeof window === "undefined") return [...DEFAULT_SIDEBAR_NAV_ORDER];
  try {
    const raw = localStorage.getItem(SIDEBAR_NAV_ORDER_STORAGE_KEY);
    if (!raw) return [...DEFAULT_SIDEBAR_NAV_ORDER];
    return mergeWithDefaults(JSON.parse(raw) as unknown, DEFAULT_SIDEBAR_NAV_ORDER);
  } catch {
    return [...DEFAULT_SIDEBAR_NAV_ORDER];
  }
}

export function readSidebarCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeSidebarCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, collapsed ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export function orderSidebarNavItems(hrefOrder: readonly string[]): SidebarNavItem[] {
  const byHref = new Map(NAV.map((item) => [item.href, item]));
  return hrefOrder
    .map((href) => byHref.get(href))
    .filter((item): item is SidebarNavItem => item != null);
}

export function readSidebarNavOrder(): SidebarNavItem[] {
  if (typeof window === "undefined") return [...NAV];
  return orderSidebarNavItems(readSidebarNavOrderFromStorage());
}

/** Index of the sidebar section for keyboard nav; nested paths use prefix or `href + "/"`. */
export function getSidebarNavIndex(pathname: string, items: SidebarNavItem[] = readSidebarNavOrder()): number {
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    if (item.prefix) {
      if (pathname.startsWith(item.prefix)) return i;
    } else if (pathname === item.href || pathname.startsWith(`${item.href}/`)) {
      return i;
    }
  }
  return 0;
}

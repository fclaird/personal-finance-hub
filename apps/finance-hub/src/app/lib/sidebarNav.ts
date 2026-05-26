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

export const DEFAULT_SIDEBAR_NAV_ORDER = NAV.map((item) => item.href);

export function orderSidebarNavItems(hrefOrder: readonly string[]): SidebarNavItem[] {
  const byHref = new Map(NAV.map((item) => [item.href, item]));
  return hrefOrder
    .map((href) => byHref.get(href))
    .filter((item): item is SidebarNavItem => item != null);
}

export function readSidebarNavOrder(): SidebarNavItem[] {
  if (typeof window === "undefined") return [...NAV];
  try {
    const raw = localStorage.getItem(SIDEBAR_NAV_ORDER_STORAGE_KEY);
    if (!raw) return [...NAV];
    return orderSidebarNavItems(mergeWithDefaults(JSON.parse(raw) as unknown, DEFAULT_SIDEBAR_NAV_ORDER));
  } catch {
    return [...NAV];
  }
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

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
  { href: "/dividend-models", label: "Sim Dividend Portfolio" },
  { href: "/rebalancing", label: "Rebalancing" },
  { href: "/alerts", label: "Alerts" },
  { href: "/posterity", label: "Posterity" },
];

/** Index of the sidebar section for keyboard nav; nested paths use prefix or `href + "/"`. */
export function getSidebarNavIndex(pathname: string): number {
  for (let i = 0; i < NAV.length; i++) {
    const item = NAV[i];
    if (item.prefix) {
      if (pathname.startsWith(item.prefix)) return i;
    } else if (pathname === item.href || pathname.startsWith(`${item.href}/`)) {
      return i;
    }
  }
  return 0;
}

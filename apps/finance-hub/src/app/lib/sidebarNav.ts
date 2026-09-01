import type { FlavorId } from "@/lib/flavor";
import { readFlavorCookieClient } from "@/lib/flavorClient";
import { navForFlavor, sidebarNavOrderStorageKey } from "@/lib/flavors/registry";
import { readPersistedOrder, persistOrder } from "@/lib/usePersistedOrder";

export type SidebarNavItem = { href: string; label: string; prefix?: string };

/** @deprecated Use navForFlavor("main") — kept for tests and legacy imports. */
export const NAV: SidebarNavItem[] = navForFlavor("main");

export const SIDEBAR_COLLAPSED_STORAGE_KEY = "fh.sidebar.collapsed.v1";

/** Pre-flavor localStorage key (migrated into `fh.sidebar.nav.order.v1.main`). */
export const SIDEBAR_NAV_ORDER_LEGACY_KEYS_MAIN = ["fh.sidebar.nav.order.v1"] as const;

export function sidebarNavOrderLegacyKeys(flavor: FlavorId): readonly string[] {
  return flavor === "main" ? SIDEBAR_NAV_ORDER_LEGACY_KEYS_MAIN : [];
}

export function defaultSidebarNavOrder(flavor: FlavorId): string[] {
  return navForFlavor(flavor).map((item) => item.href);
}

export function sidebarNavOrderStorageKeyForFlavor(flavor: FlavorId): string {
  return sidebarNavOrderStorageKey(flavor);
}

/** @deprecated Use sidebarNavOrderStorageKeyForFlavor(flavor) */
export const SIDEBAR_NAV_ORDER_STORAGE_KEY = sidebarNavOrderStorageKey("main");

/** @deprecated Use defaultSidebarNavOrder("main") */
export const DEFAULT_SIDEBAR_NAV_ORDER = defaultSidebarNavOrder("main");

export function readSidebarNavOrderFromStorage(flavor: FlavorId = "main"): string[] {
  if (typeof localStorage === "undefined") return defaultSidebarNavOrder(flavor);
  const key = sidebarNavOrderStorageKeyForFlavor(flavor);
  const defaults = defaultSidebarNavOrder(flavor);
  const legacy = sidebarNavOrderLegacyKeys(flavor);
  const order = readPersistedOrder(key, defaults, legacy);
  if (!localStorage.getItem(key) && legacy.length > 0) {
    try {
      for (const lk of legacy) {
        if (localStorage.getItem(lk)) {
          persistOrder(key, order);
          break;
        }
      }
    } catch {
      /* ignore */
    }
  }
  return order;
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

export function orderSidebarNavItems(hrefOrder: readonly string[], flavor: FlavorId = "main"): SidebarNavItem[] {
  const byHref = new Map(navForFlavor(flavor).map((item) => [item.href, item]));
  return hrefOrder
    .map((href) => byHref.get(href))
    .filter((item): item is SidebarNavItem => item != null);
}

export function readSidebarNavOrder(flavor?: FlavorId): SidebarNavItem[] {
  const active = flavor ?? readFlavorCookieClient() ?? "main";
  if (typeof localStorage === "undefined") return navForFlavor(active);
  return orderSidebarNavItems(readSidebarNavOrderFromStorage(active), active);
}

/** Index of the sidebar section for keyboard nav; nested paths use prefix or `href + "/"`. */
export function getSidebarNavIndex(
  pathname: string,
  items: SidebarNavItem[] = readSidebarNavOrder("main"),
): number {
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

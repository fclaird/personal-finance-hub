import { boundCacheSet } from "@/lib/cacheBound";
import type { NewsItem } from "@/lib/news/types";

export const NEWS_CACHE_MAX = 64;

export type NewsCacheRow = { expiresAt: number; items: NewsItem[] };

/** Drop expired RSS entries and keep a fixed number of feeds. */
export function rememberNewsCache(
  store: Map<string, NewsCacheRow>,
  key: string,
  value: NewsCacheRow,
  now = Date.now(),
  max = NEWS_CACHE_MAX,
): void {
  for (const [entryKey, row] of store) {
    if (row.expiresAt <= now) store.delete(entryKey);
  }
  boundCacheSet(store, key, value, max);
}

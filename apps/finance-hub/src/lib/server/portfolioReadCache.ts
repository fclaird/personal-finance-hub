import { isUsEquityRegularSessionOpen } from "@/lib/market/usEquitySession";
import { createSwrCache } from "@/lib/server/swrCache";

const FRESH_RTH_MS = 60_000;
const FRESH_CLOSED_MS = 600_000;
const STALE_RTH_MS = 10 * 60_000;
const STALE_CLOSED_MS = 60 * 60_000;

type PortfolioCache = ReturnType<typeof createSwrCache<unknown>>;

function portfolioCache(): PortfolioCache {
  const g = globalThis as typeof globalThis & { __fhPortfolioReadCache?: PortfolioCache };
  if (!g.__fhPortfolioReadCache) {
    g.__fhPortfolioReadCache = createSwrCache<unknown>({
      freshMs: () => (isUsEquityRegularSessionOpen() ? FRESH_RTH_MS : FRESH_CLOSED_MS),
      staleMs: () => (isUsEquityRegularSessionOpen() ? STALE_RTH_MS : STALE_CLOSED_MS),
    });
  }
  return g.__fhPortfolioReadCache;
}

export async function readThroughPortfolioCache<T>(
  key: string,
  load: () => Promise<T>,
  force = false,
): Promise<{ value: T; asOf: string; stale: boolean; refreshing: boolean }> {
  const hit = await portfolioCache().get(key, load as () => Promise<unknown>, force);
  return { ...hit, value: hit.value as T };
}

/** Refresh keys that have already been read and are past the fresh window. */
export async function revalidateStalePortfolioCache(): Promise<void> {
  await portfolioCache().revalidateStale();
}

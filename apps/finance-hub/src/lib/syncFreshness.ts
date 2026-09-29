/** Skip another external pull when the last successful run of that key is this recent. */
export const SYNC_FRESH_MS = 6 * 60 * 60 * 1000;

export const SYNC_STAMP = {
  earningsFinnhub: "earnings.finnhub",
  schwabHoldings: "schwab.holdings",
  schwabGreeks: "schwab.greeks",
  dividendsLive: "dividends.live",
} as const;

export type SyncStampKey = (typeof SYNC_STAMP)[keyof typeof SYNC_STAMP];

export function syncShouldRun(input: {
  force: boolean;
  lastSuccessAt: string | null;
  nowMs: number;
  windowMs?: number;
}): boolean {
  if (input.force) return true;
  if (!input.lastSuccessAt) return true;
  const at = Date.parse(input.lastSuccessAt);
  if (!Number.isFinite(at)) return true;
  const windowMs = input.windowMs ?? SYNC_FRESH_MS;
  return input.nowMs - at > windowMs;
}

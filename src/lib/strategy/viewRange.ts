import { MAX_TRANSACTION_LOOKBACK_DAYS } from "@/lib/schwab/config";

/** Default lookback depth for UIs that still need a calendar window (not used by strategy-trades listing). */
export const STRATEGY_VIEW_LOOKBACK_DAYS = MAX_TRANSACTION_LOOKBACK_DAYS;

export function defaultStrategyViewRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - STRATEGY_VIEW_LOOKBACK_DAYS * 24 * 3600 * 1000);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

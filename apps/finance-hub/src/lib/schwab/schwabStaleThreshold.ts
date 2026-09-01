/** Client-safe Schwab refresh staleness thresholds (no DB imports). */
export const SCHWAB_STALE_THRESHOLD_RTH_MS = 60_000;
export const SCHWAB_STALE_THRESHOLD_CLOSED_MS = 600_000;

export function schwabStaleThresholdMs(rthOpen: boolean): number {
  return rthOpen ? SCHWAB_STALE_THRESHOLD_RTH_MS : SCHWAB_STALE_THRESHOLD_CLOSED_MS;
}

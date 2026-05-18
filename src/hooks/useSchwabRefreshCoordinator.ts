"use client";

import { useCallback, useEffect, useRef } from "react";

import { useMarketAwareInterval } from "@/hooks/useMarketAwareInterval";

type RefreshStatus = {
  ok: boolean;
  stale?: boolean;
  isRunning?: boolean;
  lastSuccessAt?: string | null;
  staleThresholdMs?: number;
};

/**
 * On mount: refresh Schwab-backed DB if stale. While mounted: optional `onTick` on market-aware interval.
 */
export function useSchwabRefreshCoordinator(opts: {
  onTick?: () => void | Promise<void>;
  enabled?: boolean;
  resetKey?: string;
}) {
  const { onTick, enabled = true, resetKey = "" } = opts;
  const refreshInFlight = useRef(false);
  const onTickRef = useRef(onTick);

  useEffect(() => {
    onTickRef.current = onTick;
  });

  const ensureFresh = useCallback(async () => {
    if (!enabled || refreshInFlight.current) return;
    refreshInFlight.current = true;
    try {
      const statusResp = await fetch("/api/schwab/refresh-status", { cache: "no-store" });
      const status = (await statusResp.json()) as RefreshStatus;
      if (!status.ok) return;
      if (status.isRunning) return;
      if (status.stale !== true) return;

      // Fire-and-forget: do NOT block page load on full Schwab refresh.
      void fetch("/api/schwab/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "stale_navigation" }),
      }).catch(() => {});
    } catch {
      /* ignore */
    } finally {
      refreshInFlight.current = false;
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const tick = onTickRef.current;
    if (tick) {
      void Promise.resolve(tick()).finally(() => {
        void ensureFresh();
      });
    } else {
      void ensureFresh();
    }
  }, [enabled, ensureFresh, resetKey]);

  useMarketAwareInterval(
    () => {
      if (!onTick) return;
      void onTick();
    },
    60_000,
    600_000,
    resetKey,
    false,
  );

  return { ensureFresh };
}

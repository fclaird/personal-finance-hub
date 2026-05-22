"use client";

import { useEffect, useRef } from "react";

import { isUsEquityRegularSessionOpen } from "@/lib/market/usEquitySession";

const META_MS = 30_000;

/**
 * Runs `callback` on an interval that depends on US equity session:
 * `openIntervalMs` during RTH, `closedIntervalMs` when closed.
 * Re-arms around session open/close without page reload.
 */
export function useMarketAwareInterval(
  callback: () => void | Promise<void>,
  openIntervalMs: number,
  closedIntervalMs: number,
  resetKey = "",
  fireImmediately = true,
) {
  const cbRef = useRef(callback);

  useEffect(() => {
    cbRef.current = callback;
  });

  useEffect(() => {
    let innerId: ReturnType<typeof setInterval> | null = null;
    let currentMs = 0;

    const disarm = () => {
      if (innerId != null) {
        clearInterval(innerId);
        innerId = null;
      }
    };

    const arm = () => {
      const open = isUsEquityRegularSessionOpen(new Date());
      const ms = open ? openIntervalMs : closedIntervalMs;
      if (innerId != null && ms === currentMs) return;
      disarm();
      currentMs = ms;
      if (fireImmediately) void cbRef.current();
      innerId = setInterval(() => void cbRef.current(), ms);
    };

    arm();

    const metaId = setInterval(() => {
      const open = isUsEquityRegularSessionOpen(new Date());
      const ms = open ? openIntervalMs : closedIntervalMs;
      if (ms !== currentMs) {
        arm();
      }
    }, META_MS);

    return () => {
      clearInterval(metaId);
      disarm();
    };
  }, [openIntervalMs, closedIntervalMs, resetKey, fireImmediately]);
}

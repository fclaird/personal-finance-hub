"use client";

import { useEffect, useRef } from "react";

import { isUsEquityRegularSessionOpen } from "@/lib/market/usEquitySession";

const META_MS = 30_000;

/**
 * Runs `callback` every `intervalMs` while US equity RTH is open.
 * Uses a short meta-timer to arm/disarm around session open/close without page reload.
 *
 * Pass a stable `resetKey` string (not a variable-length dependency list) when the poll
 * schedule should reset — e.g. watchlist or view changes.
 */
export function useEquityMarketPolling(
  callback: () => void | Promise<void>,
  intervalMs: number,
  resetKey = "",
) {
  const cbRef = useRef(callback);

  useEffect(() => {
    cbRef.current = callback;
  });

  useEffect(() => {
    let innerId: ReturnType<typeof setInterval> | null = null;

    const disarm = () => {
      if (innerId != null) {
        clearInterval(innerId);
        innerId = null;
      }
    };

    const arm = () => {
      if (innerId != null) return;
      if (!isUsEquityRegularSessionOpen(new Date())) return;
      void cbRef.current();
      innerId = setInterval(() => void cbRef.current(), intervalMs);
    };

    if (isUsEquityRegularSessionOpen(new Date())) arm();

    const metaId = setInterval(() => {
      if (isUsEquityRegularSessionOpen(new Date())) {
        if (innerId == null) arm();
      } else {
        disarm();
      }
    }, META_MS);

    return () => {
      clearInterval(metaId);
      disarm();
    };
  }, [intervalMs, resetKey]);
}

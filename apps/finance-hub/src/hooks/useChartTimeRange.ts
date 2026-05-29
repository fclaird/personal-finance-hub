"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { glanceSessionYmd } from "@/lib/market/glanceSession";
import { GLANCE_RTH_CLOSE_MIN, GLANCE_RTH_OPEN_MIN } from "@/lib/market/glanceTileChartWindow";
import { nyWallTimeMs } from "@/lib/market/futuresGlanceSession";
import { windowSinceMs } from "@/lib/terminal/candleWindowTime";

export type VisibleTimeRange = { fromMs: number; toMs: number };

function defaultVisibleForWindow(
  window: CandleWindowKey,
  loadedFromMs: number,
  loadedToMs: number,
  nowMs: number,
): VisibleTimeRange {
  if (loadedToMs <= loadedFromMs) {
    return { fromMs: loadedFromMs, toMs: loadedToMs };
  }
  if (window === "1D") {
    const sessionYmd = glanceSessionYmd(new Date(nowMs));
    const openMs = nyWallTimeMs(sessionYmd, GLANCE_RTH_OPEN_MIN);
    const closeMs = nyWallTimeMs(sessionYmd, GLANCE_RTH_CLOSE_MIN);
    const fromMs = Math.max(loadedFromMs, openMs);
    const toMs = Math.min(loadedToMs, Math.max(closeMs, nowMs));
    if (toMs > fromMs) return { fromMs, toMs };
  }
  return { fromMs: loadedFromMs, toMs: loadedToMs };
}

export type UseChartTimeRangeOptions = {
  window: CandleWindowKey;
  loadedFromMs: number | null;
  loadedToMs: number | null;
  /** Reset visible range when these change */
  resetKey?: string;
};

export type UseChartTimeRangeResult = {
  visibleRange: VisibleTimeRange | null;
  setVisibleRange: (range: VisibleTimeRange) => void;
  panByMs: (deltaMs: number) => void;
  onWheelPan: (e: React.WheelEvent) => void;
  needsEarlierData: boolean;
  needsLaterData: boolean;
};

const EDGE_FRAC = 0.1;

export function useChartTimeRange({
  window,
  loadedFromMs,
  loadedToMs,
  resetKey = "",
}: UseChartTimeRangeOptions): UseChartTimeRangeResult {
  const [visibleRange, setVisibleRangeState] = useState<VisibleTimeRange | null>(null);
  const loadedRef = useRef({ from: loadedFromMs, to: loadedToMs });

  useEffect(() => {
    loadedRef.current = { from: loadedFromMs, to: loadedToMs };
  }, [loadedFromMs, loadedToMs]);

  useEffect(() => {
    if (loadedFromMs == null || loadedToMs == null || loadedToMs <= loadedFromMs) {
      setVisibleRangeState(null);
      return;
    }
    const nowMs = Date.now();
    setVisibleRangeState(defaultVisibleForWindow(window, loadedFromMs, loadedToMs, nowMs));
  }, [window, loadedFromMs, loadedToMs, resetKey]);

  const setVisibleRange = useCallback((range: VisibleTimeRange) => {
    const { from: loadedFrom, to: loadedTo } = loadedRef.current;
    if (loadedFrom == null || loadedTo == null) {
      setVisibleRangeState(range);
      return;
    }
    const span = range.toMs - range.fromMs;
    let fromMs = range.fromMs;
    let toMs = range.toMs;
    if (fromMs < loadedFrom) {
      fromMs = loadedFrom;
      toMs = fromMs + span;
    }
    if (toMs > loadedTo) {
      toMs = loadedTo;
      fromMs = toMs - span;
    }
    if (fromMs < loadedFrom) fromMs = loadedFrom;
    setVisibleRangeState({ fromMs, toMs });
  }, []);

  const panByMs = useCallback(
    (deltaMs: number) => {
      setVisibleRangeState((prev) => {
        if (!prev) return prev;
        const span = prev.toMs - prev.fromMs;
        const { from: loadedFrom, to: loadedTo } = loadedRef.current;
        let fromMs = prev.fromMs + deltaMs;
        let toMs = prev.toMs + deltaMs;
        if (loadedFrom != null && fromMs < loadedFrom) {
          fromMs = loadedFrom;
          toMs = fromMs + span;
        }
        if (loadedTo != null && toMs > loadedTo) {
          toMs = loadedTo;
          fromMs = toMs - span;
        }
        if (loadedFrom != null && fromMs < loadedFrom) fromMs = loadedFrom;
        return { fromMs, toMs };
      });
    },
    [],
  );

  const onWheelPan = useCallback(
    (e: React.WheelEvent) => {
      if (!visibleRange) return;
      e.preventDefault();
      const span = visibleRange.toMs - visibleRange.fromMs;
      const delta = (e.deltaX !== 0 ? e.deltaX : e.deltaY) * (span / 800);
      panByMs(delta);
    },
    [visibleRange, panByMs],
  );

  const { needsEarlierData, needsLaterData } = useMemo(() => {
    if (!visibleRange || loadedFromMs == null || loadedToMs == null) {
      return { needsEarlierData: false, needsLaterData: false };
    }
    const span = visibleRange.toMs - visibleRange.fromMs;
    const edge = Math.max(span * EDGE_FRAC, 60_000);
    const windowStartMs = windowSinceMs(window);
    // At initial load visible.fromMs === loadedFromMs (diff 0), which falsely looked like
    // "near the left edge — fetch more". Only extend when panned near edge AND more history exists.
    return {
      needsEarlierData:
        visibleRange.fromMs - loadedFromMs < edge && loadedFromMs > windowStartMs + edge,
      needsLaterData:
        loadedToMs - visibleRange.toMs < edge && loadedToMs < Date.now() - edge,
    };
  }, [visibleRange, loadedFromMs, loadedToMs, window]);

  return {
    visibleRange,
    setVisibleRange,
    panByMs,
    onWheelPan,
    needsEarlierData,
    needsLaterData,
  };
}

import {
  cmePreviousSessionLastClose,
  type FuturesGlanceKind,
} from "@/lib/market/futuresGlanceSession";
import type { TimedClosePoint } from "@/lib/market/glanceExtendedHours";

function asNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

export function futuresGlanceDayChange(last: number | null, previousClose: number | null): {
  change: number | null;
  changePct: number | null;
} {
  if (last == null || previousClose == null || previousClose === 0) {
    return { change: null, changePct: null };
  }
  const change = last - previousClose;
  return { change, changePct: (change / previousClose) * 100 };
}

/**
 * Prior settle for ES/NQ (and other Globex tiles) day change.
 *
 * Yahoo 5d charts set `chartPreviousClose` to the close *before the first bar of the range*
 * (often several sessions ago). That is not the prior Globex settlement. Wires use
 * `previousClose` / `regularMarketPreviousClose` (e.g. ES 7598.5, NQ 29135 on 2026-09-11).
 *
 * Do not fall back to the current session's first print or a cash QQQ/SPY prior.
 */
export function resolveFuturesGlancePreviousClose(opts: {
  meta?: Record<string, unknown> | null;
  timed?: TimedClosePoint[];
  kind: FuturesGlanceKind;
  now: Date;
}): number | null {
  const official =
    asNum(opts.meta?.previousClose) ?? asNum(opts.meta?.regularMarketPreviousClose);
  if (official != null) return official;

  if (opts.kind === "cme_equity_index" && opts.timed && opts.timed.length > 0) {
    const fromPriorSession = cmePreviousSessionLastClose(opts.timed, opts.now);
    if (fromPriorSession != null) return fromPriorSession;
  }

  // 1d charts: chartPreviousClose equals the daily settle. 5d charts: it does not.
  return asNum(opts.meta?.chartPreviousClose);
}

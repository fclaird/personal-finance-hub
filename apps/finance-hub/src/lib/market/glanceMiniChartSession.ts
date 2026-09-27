import { nyWallTimeMs, cmeEquityIndexFuturesPhase, type CmeFuturesPhase } from "@/lib/market/futuresGlanceSession";
import { glanceSessionYmd } from "@/lib/market/glanceSession";
import {
  isNyseHolidayYmd,
  isUsEquityRegularSessionOpen,
  nyMinutesSinceMidnight,
  nyWeekdayIso,
  nyYmd,
} from "@/lib/market/usEquitySession";

/**
 * Quick-glance mini charts (Terminal, top row).
 *
 * Regular session (09:30–16:00 America/New_York): cash symbols, previous
 * session's close as the only horizontal reference, x positions proportional
 * to time across the full 6.5h session.
 *
 * Cash closed (pre-market, after the bell, overnight, weekends, NYSE holidays):
 * Nasdaq → NQ, S&P 500 → ES, Russell 2000 → RTY. The chart is a fresh futures
 * series of tradable ticks since that session's 16:00 ET cash close, indexed
 * to the futures print at the bell. That level stays locked until the next
 * regular open. It does not append to the cash intraday path.
 *
 * Day % on the ES/NQ/RTY card stays the Globex settle (`previousClose`, PR #160).
 * The chart reference is a different price: the locked cash-session close.
 * Gold (GC), WTI (CL), crypto, VIX, Nikkei, and FTSE are not remapped — they
 * are already futures, 24h, or a different venue. VX is not a VIX-level proxy.
 *
 * No early-close calendar: half-days still use 16:00 ET.
 */

const RTH_OPEN_MIN = 9 * 60 + 30;
const RTH_CLOSE_MIN = 16 * 60;
const PREMARKET_START_MIN = 4 * 60;
const POST_MARKET_END_MIN = 20 * 60;

/** Cash index id → e-mini used while the US cash session is closed. */
export const GLANCE_CLOSED_SESSION_PROXY: Readonly<Record<string, string>> = {
  nasdaq: "us-nq",
  sp500: "us-es",
  russell2000: "us-rty",
};

export type GlanceCashPhase = "rth" | "premarket" | "post_close" | "overnight" | "weekend" | "holiday";

export type GlanceChartReference = "previous_close" | "locked_session_close";

export type GlanceMiniChartState = {
  phase: GlanceCashPhase;
  cashSessionOpen: boolean;
  /** Regular session whose close is the locked reference while cash is shut. During RTH, today. */
  lockedSessionYmd: string;
  reference: GlanceChartReference;
  /** Full cash session axis (09:30–16:00 ET) for the locked session. */
  rthStartMs: number;
  rthEndMs: number;
  /** Futures plot window while cash is closed: cash close → next regular open. Null during RTH. */
  closedPlotStartMs: number | null;
  closedPlotEndMs: number | null;
  globexPhase: CmeFuturesPhase;
};

export type PostCashClosePoint = { tsMs: number; close: number };

export type PostCashClosePlot = {
  lockedSessionYmd: string;
  cashCloseMs: number;
  nextOpenMs: number;
  referencePrice: number;
  points: PostCashClosePoint[];
};

export function glanceTimeFraction(tsMs: number, startMs: number, endMs: number): number {
  const span = endMs - startMs;
  if (!(span > 0) || !Number.isFinite(tsMs)) return 0;
  return (tsMs - startMs) / span;
}

/** X endpoints of the session reference line: the full axis, not the last print. */
export function glanceReferenceLineXs(startMs: number, endMs: number): [number, number] {
  return [startMs, endMs];
}

function isCashSessionYmd(ymd: string): boolean {
  const probe = new Date(`${ymd}T16:00:00Z`);
  const wd = nyWeekdayIso(probe);
  if (wd < 1 || wd > 5) return false;
  return !isNyseHolidayYmd(ymd);
}

function addNyCalendarDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return nyYmd(new Date(Date.UTC(y!, m! - 1, d! + days, 16, 0, 0)));
}

/** Next 09:30 ET regular open strictly after `now` when cash is already shut; today if still pre-open. */
export function nextRegularSessionOpenMs(now: Date): number {
  const ymd = nyYmd(now);
  const mins = nyMinutesSinceMidnight(now);
  if (isCashSessionYmd(ymd) && mins < RTH_OPEN_MIN) {
    return nyWallTimeMs(ymd, RTH_OPEN_MIN);
  }
  let cursor = addNyCalendarDays(ymd, 1);
  for (let i = 0; i < 12; i++) {
    if (isCashSessionYmd(cursor)) return nyWallTimeMs(cursor, RTH_OPEN_MIN);
    cursor = addNyCalendarDays(cursor, 1);
  }
  return nyWallTimeMs(addNyCalendarDays(ymd, 1), RTH_OPEN_MIN);
}

export function glanceCashPhase(now: Date): GlanceCashPhase {
  const ymd = nyYmd(now);
  const wd = nyWeekdayIso(now);
  if (wd === 6 || wd === 7) return "weekend";
  if (isNyseHolidayYmd(ymd)) return "holiday";
  if (isUsEquityRegularSessionOpen(now)) return "rth";
  const mins = nyMinutesSinceMidnight(now);
  if (mins >= PREMARKET_START_MIN && mins < RTH_OPEN_MIN) return "premarket";
  if (mins >= RTH_CLOSE_MIN && mins < POST_MARKET_END_MIN) return "post_close";
  return "overnight";
}

export function glanceMiniChartState(now: Date = new Date()): GlanceMiniChartState {
  const phase = glanceCashPhase(now);
  const cashSessionOpen = phase === "rth";
  const lockedSessionYmd = glanceSessionYmd(now);
  return {
    phase,
    cashSessionOpen,
    lockedSessionYmd,
    reference: cashSessionOpen ? "previous_close" : "locked_session_close",
    rthStartMs: nyWallTimeMs(lockedSessionYmd, RTH_OPEN_MIN),
    rthEndMs: nyWallTimeMs(lockedSessionYmd, RTH_CLOSE_MIN),
    closedPlotStartMs: cashSessionOpen ? null : nyWallTimeMs(lockedSessionYmd, RTH_CLOSE_MIN),
    closedPlotEndMs: cashSessionOpen ? null : nextRegularSessionOpenMs(now),
    globexPhase: cmeEquityIndexFuturesPhase(now.getTime()),
  };
}

/** Keep the stored id during RTH. Outside RTH, map cash index slots onto e-minis. */
export function resolveGlanceInstrumentId(storedId: string, now: Date = new Date()): string {
  if (isUsEquityRegularSessionOpen(now)) return storedId;
  return GLANCE_CLOSED_SESSION_PROXY[storedId] ?? storedId;
}

/**
 * Futures ticks since the locked cash close, against the futures print at that bell.
 * Premarket / overnight / weekend / holiday only — null during RTH.
 * Does not include bars from before the bell (no blend into that day's cash path).
 */
export function buildPostCashClosePlot(
  points: PostCashClosePoint[],
  now: Date,
): PostCashClosePlot | null {
  const state = glanceMiniChartState(now);
  if (state.cashSessionOpen || state.closedPlotStartMs == null || state.closedPlotEndMs == null) {
    return null;
  }
  const cashCloseMs = state.closedPlotStartMs;
  const nextOpenMs = state.closedPlotEndMs;
  const sessionYmd = state.lockedSessionYmd;

  let ref: PostCashClosePoint | null = null;
  for (const p of points) {
    if (!Number.isFinite(p.close) || !Number.isFinite(p.tsMs)) continue;
    if (p.tsMs > cashCloseMs) continue;
    if (nyYmd(new Date(p.tsMs)) !== sessionYmd) continue;
    if (cmeEquityIndexFuturesPhase(p.tsMs) !== "tradable") continue;
    if (!ref || p.tsMs >= ref.tsMs) ref = p;
  }
  if (!ref) return null;

  const nowMs = now.getTime();
  const ticks = points
    .filter((p) => {
      if (!Number.isFinite(p.close) || !Number.isFinite(p.tsMs)) return false;
      if (p.tsMs <= cashCloseMs || p.tsMs > nowMs || p.tsMs >= nextOpenMs) return false;
      return cmeEquityIndexFuturesPhase(p.tsMs) === "tradable";
    })
    .sort((a, b) => a.tsMs - b.tsMs);

  const series: PostCashClosePoint[] = [{ tsMs: cashCloseMs, close: ref.close }];
  for (const t of ticks) series.push(t);
  if (series.length === 1) {
    series.push({ tsMs: cashCloseMs + 60_000, close: ref.close });
  }

  return {
    lockedSessionYmd: sessionYmd,
    cashCloseMs,
    nextOpenMs,
    referencePrice: ref.close,
    points: series,
  };
}

const CLOSED_PROXY_IDS = new Set(["us-es", "us-nq", "us-rty"]);

type ClosedSessionCard = {
  id: string;
  series: Array<{ idx: number; close: number; tsMs?: number }>;
  extendedSeries?: Array<{ idx: number; close: number; tsMs?: number }> | null;
  sessionClose?: number | null;
  extendedLast?: number | null;
  extendedChange?: number | null;
  extendedChangePct?: number | null;
  extendedPhase?: "pre" | "post" | null;
  previousClose?: number | null;
  change?: number | null;
  changePct?: number | null;
  postCashClose?: PostCashClosePlot | null;
  chartReferencePrice?: number | null;
  timeAxis?: { startMs: number; endMs: number } | null;
};

/**
 * Markets-tile view of ES/NQ/RTY while cash is closed.
 * Replaces the series with post-cash ticks and sets the chart reference to the
 * locked bell print. Leaves `previousClose` / `change` / `changePct` alone so
 * the Globex settle day % from PR #160 still drives the Day figure.
 */
export function applyClosedSessionFuturesView<T extends ClosedSessionCard>(card: T, now: Date): T {
  if (isUsEquityRegularSessionOpen(now)) return card;
  if (!CLOSED_PROXY_IDS.has(card.id)) return card;
  const plot = card.postCashClose;
  if (!plot || plot.points.length === 0) return card;
  return {
    ...card,
    series: plot.points.map((p, idx) => ({ idx, close: p.close, tsMs: p.tsMs })),
    extendedSeries: undefined,
    sessionClose: plot.referencePrice,
    extendedLast: null,
    extendedChange: null,
    extendedChangePct: null,
    extendedPhase: null,
    chartReferencePrice: plot.referencePrice,
    timeAxis: { startMs: plot.cashCloseMs, endMs: plot.nextOpenMs },
  };
}

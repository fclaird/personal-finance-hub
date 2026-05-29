import {
  glanceSessionYmd,
  isoDateInUsEastern,
} from "@/lib/market/glanceSession";
import {
  isNyseHolidayYmd,
  isUsEquityRegularSessionOpen,
  nyMinutesSinceMidnight,
  nyWeekdayIso,
  nyYmd,
} from "@/lib/market/usEquitySession";

export type GlanceExtendedPhase = "pre" | "post";

export type GlanceChartContext = {
  sessionYmd: string;
  chartYmd: string;
  extendedPhase: GlanceExtendedPhase | null;
  showExtended: boolean;
};

export type TimedClosePoint = { tsMs: number; close: number };

export type GlanceSeriesPoint = { idx: number; close: number; tsMs?: number };

export type GlanceExtendedFields = {
  extendedSeries?: GlanceSeriesPoint[];
  sessionClose?: number | null;
  extendedLast?: number | null;
  extendedChange?: number | null;
  extendedChangePct?: number | null;
  extendedPhase?: GlanceExtendedPhase | null;
};

export const US_EQUITY_PRE_MARKET_START_MIN = 4 * 60;
export const US_EQUITY_POST_MARKET_END_MIN = 20 * 60;

const PRE_MARKET_START = US_EQUITY_PRE_MARKET_START_MIN;
const RTH_OPEN = 9 * 60 + 30;
const RTH_CLOSE = 16 * 60;
const POST_MARKET_END = US_EQUITY_POST_MARKET_END_MIN;

/** Non-trading gap: 20:00–04:00 ET (wall clock on each calendar day). */
export function isUsEquityOvernightDeadZone(tsMs: number): boolean {
  const mins = nyMinutesSinceMidnight(new Date(tsMs));
  return mins >= POST_MARKET_END || mins < PRE_MARKET_START;
}

/** Pre-market (04:00–09:30 ET) or after-hours (16:00–20:00 ET) on a US equity session day. */
export function usEquityExtendedHoursPhase(now: Date = new Date()): GlanceExtendedPhase | null {
  const wd = nyWeekdayIso(now);
  if (wd < 1 || wd > 5) return null;
  const ymd = nyYmd(now);
  if (isNyseHolidayYmd(ymd)) return null;
  const mins = nyMinutesSinceMidnight(now);
  if (mins >= PRE_MARKET_START && mins < RTH_OPEN) return "pre";
  if (mins >= RTH_CLOSE && mins < POST_MARKET_END) return "post";
  return null;
}

export function nyBarPhase(tsMs: number, ymd: string): "regular" | GlanceExtendedPhase | "other" {
  if (isoDateInUsEastern(tsMs) !== ymd) return "other";
  const mins = nyMinutesSinceMidnight(new Date(tsMs));
  if (mins >= RTH_OPEN && mins < RTH_CLOSE) return "regular";
  if (mins >= PRE_MARKET_START && mins < RTH_OPEN) return "pre";
  if (mins >= RTH_CLOSE && mins < POST_MARKET_END) return "post";
  return "other";
}

/** Which session day to chart and whether to append extended-hours segment. */
export function glanceChartContext(now: Date = new Date()): GlanceChartContext {
  const today = nyYmd(now);
  const extendedPhase = usEquityExtendedHoursPhase(now);

  if (isUsEquityRegularSessionOpen(now)) {
    return { sessionYmd: today, chartYmd: today, extendedPhase: null, showExtended: false };
  }

  if (extendedPhase === "post") {
    return { sessionYmd: today, chartYmd: today, extendedPhase: "post", showExtended: true };
  }

  if (extendedPhase === "pre") {
    return {
      sessionYmd: glanceSessionYmd(now),
      chartYmd: today,
      extendedPhase: "pre",
      showExtended: true,
    };
  }

  const sessionYmd = glanceSessionYmd(now);
  return { sessionYmd, chartYmd: sessionYmd, extendedPhase: null, showExtended: false };
}

/** Enable extended split on charts when timed bars include pre/post data (even outside live extended window). */
export function resolveGlanceSplitContext(
  ctx: GlanceChartContext,
  points: TimedClosePoint[],
  now: Date = new Date(),
): GlanceChartContext {
  if (ctx.showExtended && ctx.extendedPhase) return ctx;

  // During RTH chart only today's regular session — do not attach pre/post from the feed.
  if (isUsEquityRegularSessionOpen(now)) {
    return ctx;
  }

  const ymd = ctx.chartYmd;
  const hasPost = points.some((p) => nyBarPhase(p.tsMs, ymd) === "post");
  if (hasPost) {
    return { ...ctx, showExtended: true, extendedPhase: "post" };
  }

  const hasPre = points.some((p) => nyBarPhase(p.tsMs, ymd) === "pre");
  if (hasPre && ctx.sessionYmd === ymd) {
    return { ...ctx, showExtended: true, extendedPhase: "pre" };
  }

  return ctx;
}

export function extractYahooTimedCloses(result: Record<string, unknown>): TimedClosePoint[] {
  const quote = (result.indicators as Record<string, unknown> | undefined)?.quote as
    | Array<Record<string, unknown>>
    | undefined;
  const q0 = quote?.[0];
  const closes = (q0?.close as Array<number | null> | undefined) ?? [];
  const timestamps = (result.timestamp as number[] | undefined) ?? [];
  const out: TimedClosePoint[] = [];
  for (let i = 0; i < closes.length; i++) {
    const c = closes[i];
    const ts = timestamps[i];
    if (c == null || ts == null || !Number.isFinite(c)) continue;
    out.push({ tsMs: ts * 1000, close: c });
  }
  return out;
}

export function splitTimedPointsForGlance(
  points: TimedClosePoint[],
  ctx: GlanceChartContext,
): {
  regular: GlanceSeriesPoint[];
  extended: GlanceSeriesPoint[];
  sessionClose: number | null;
} {
  const regularPts = points.filter(
    (p) => nyBarPhase(p.tsMs, ctx.sessionYmd) === "regular",
  );
  const extendedPts =
    ctx.showExtended && ctx.extendedPhase
      ? points.filter((p) => nyBarPhase(p.tsMs, ctx.chartYmd) === ctx.extendedPhase)
      : [];

  const sessionClose = regularPts.length > 0 ? regularPts[regularPts.length - 1]!.close : null;
  const regular = regularPts.map((p, idx) => ({ idx, close: p.close, tsMs: p.tsMs }));

  let extended: GlanceSeriesPoint[] = [];
  if (extendedPts.length > 0) {
    const anchor = sessionClose ?? extendedPts[0]!.close;
    const startIdx = regular.length > 0 ? regular.length - 1 : 0;
    const anchorTs = regularPts.length > 0 ? regularPts[regularPts.length - 1]!.tsMs : extendedPts[0]!.tsMs;
    extended = [{ idx: startIdx, close: anchor, tsMs: anchorTs }];
    for (let i = 0; i < extendedPts.length; i++) {
      extended.push({ idx: startIdx + 1 + i, close: extendedPts[i]!.close, tsMs: extendedPts[i]!.tsMs });
    }
    if (extended.length > 1 && extended[0]!.close === extended[1]!.close) {
      extended = extended.slice(1).map((p, i) => ({ idx: startIdx + 1 + i, close: p.close, tsMs: p.tsMs }));
    }
  }

  return { regular, extended, sessionClose };
}

export function computeExtendedChange(
  sessionClose: number | null,
  extendedLast: number | null,
): { extendedChange: number | null; extendedChangePct: number | null } {
  if (sessionClose == null || extendedLast == null || sessionClose === 0) {
    return { extendedChange: null, extendedChangePct: null };
  }
  const extendedChange = extendedLast - sessionClose;
  return { extendedChange, extendedChangePct: (extendedChange / sessionClose) * 100 };
}

export function buildExtendedFallbackSeries(
  regular: GlanceSeriesPoint[],
  sessionClose: number | null,
  extendedLast: number | null,
  now: Date = new Date(),
): GlanceSeriesPoint[] {
  if (sessionClose == null || extendedLast == null) return [];
  const ref = Math.max(Math.abs(sessionClose), 1e-9);
  if (Math.abs(extendedLast - sessionClose) / ref < 0.00005) return [];
  const startIdx = regular.length > 0 ? regular[regular.length - 1]!.idx : 0;
  const anchorTs = regular.length > 0 ? regular[regular.length - 1]!.tsMs : undefined;
  return [
    { idx: startIdx, close: sessionClose, tsMs: anchorTs },
    { idx: startIdx + 1, close: extendedLast, tsMs: now.getTime() },
  ];
}

export function extendedPhaseLabel(phase: GlanceExtendedPhase | null | undefined): string {
  if (phase === "pre") return "Pre-market";
  if (phase === "post") return "After hours";
  return "Extended";
}

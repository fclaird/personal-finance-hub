import type { GlanceChartContext, GlanceExtendedPhase, GlanceSeriesPoint, TimedClosePoint } from "@/lib/market/glanceExtendedHours";

const TOKYO_TZ = "Asia/Tokyo";
const TOKYO_OPEN = 9 * 60;
const TOKYO_LUNCH_START = 11 * 60 + 30;
const TOKYO_LUNCH_END = 12 * 60 + 30;
const TOKYO_CLOSE = 15 * 60;

function tzMinutesSinceMidnight(tsMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(new Date(tsMs));
  let h = 0;
  let m = 0;
  for (const p of parts) {
    if (p.type === "hour") h = Number(p.value);
    if (p.type === "minute") m = Number(p.value);
  }
  return h * 60 + m;
}

function tzWeekdayIso(tsMs: number, timeZone: string): number {
  const w = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(new Date(tsMs));
  const map: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return map[w] ?? 0;
}

export function tokyoYmd(tsMs: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TOKYO_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(tsMs));
}

export function tokyoYmdFromDate(now: Date): string {
  return tokyoYmd(now.getTime());
}

/** TSE cash session segment for a bar on a Tokyo calendar day. */
export function tokyoBarPhase(
  tsMs: number,
  ymd: string,
): "regular" | GlanceExtendedPhase | "other" {
  if (tokyoYmd(tsMs) !== ymd) return "other";
  const wd = tzWeekdayIso(tsMs, TOKYO_TZ);
  if (wd < 1 || wd > 5) return "other";
  const mins = tzMinutesSinceMidnight(tsMs, TOKYO_TZ);
  if (mins >= TOKYO_OPEN && mins < TOKYO_LUNCH_START) return "regular";
  if (mins >= TOKYO_LUNCH_END && mins < TOKYO_CLOSE) return "regular";
  if (mins < TOKYO_OPEN) return "pre";
  if (mins >= TOKYO_CLOSE) return "post";
  return "other";
}

export function isTokyoCashSessionOpen(now: Date = new Date()): boolean {
  return tokyoBarPhase(now.getTime(), tokyoYmdFromDate(now)) === "regular";
}

function tokyoExtendedPhase(now: Date): GlanceExtendedPhase | null {
  const ymd = tokyoYmdFromDate(now);
  const wd = tzWeekdayIso(now.getTime(), TOKYO_TZ);
  if (wd < 1 || wd > 5) return null;
  const phase = tokyoBarPhase(now.getTime(), ymd);
  if (phase === "pre" || phase === "post") return phase;
  return null;
}

function lastTokyoSessionYmd(now: Date): string {
  if (isTokyoCashSessionOpen(now)) return tokyoYmdFromDate(now);

  let cursor = now;
  for (let i = 0; i < 12; i++) {
    const ymd = tokyoYmd(cursor.getTime());
    const wd = tzWeekdayIso(cursor.getTime(), TOKYO_TZ);
    if (wd >= 1 && wd <= 5) {
      const isToday = ymd === tokyoYmdFromDate(now);
      if (!isToday) return ymd;
      if (tzMinutesSinceMidnight(now.getTime(), TOKYO_TZ) >= TOKYO_CLOSE) return ymd;
    }
    cursor = new Date(cursor.getTime() - 24 * 60 * 60 * 1000);
  }
  return tokyoYmdFromDate(now);
}

/** Which Tokyo session day to chart and whether to append extended segment. */
export function tokyoGlanceChartContext(now: Date = new Date()): GlanceChartContext {
  const today = tokyoYmdFromDate(now);
  const extendedPhase = tokyoExtendedPhase(now);

  if (isTokyoCashSessionOpen(now)) {
    return { sessionYmd: today, chartYmd: today, extendedPhase: null, showExtended: false };
  }

  if (extendedPhase === "post") {
    return { sessionYmd: today, chartYmd: today, extendedPhase: "post", showExtended: true };
  }

  if (extendedPhase === "pre") {
    return {
      sessionYmd: lastTokyoSessionYmd(now),
      chartYmd: today,
      extendedPhase: "pre",
      showExtended: true,
    };
  }

  const sessionYmd = lastTokyoSessionYmd(now);
  return { sessionYmd, chartYmd: sessionYmd, extendedPhase: null, showExtended: false };
}

export function resolveTokyoSplitContext(
  ctx: GlanceChartContext,
  points: TimedClosePoint[],
): GlanceChartContext {
  if (ctx.showExtended && ctx.extendedPhase) return ctx;

  const ymd = ctx.chartYmd;
  const hasPost = points.some((p) => tokyoBarPhase(p.tsMs, ymd) === "post");
  if (hasPost) {
    return { ...ctx, showExtended: true, extendedPhase: "post" };
  }

  const hasPre = points.some((p) => tokyoBarPhase(p.tsMs, ymd) === "pre");
  if (hasPre && ctx.sessionYmd !== ymd) {
    return { ...ctx, showExtended: true, extendedPhase: "pre" };
  }

  return ctx;
}

export function cashIndexSegmentLabel(
  segment: "prior" | "regular" | "extended",
  extendedPhase?: GlanceExtendedPhase | null,
  venue: "tokyo" | "london" = "tokyo",
): string {
  if (segment === "prior") return "Prior close";
  if (segment === "extended") {
    if (extendedPhase === "pre") return "Pre-open";
    return "After hours";
  }
  return venue === "london" ? "London session" : "Tokyo session";
}

export function splitTimedPointsForCashIndexGlance(
  points: TimedClosePoint[],
  ctx: GlanceChartContext,
): {
  regular: GlanceSeriesPoint[];
  extended: GlanceSeriesPoint[];
  sessionClose: number | null;
  last: number | null;
} {
  const regularPts = points.filter((p) => tokyoBarPhase(p.tsMs, ctx.sessionYmd) === "regular");
  const extendedPts =
    ctx.showExtended && ctx.extendedPhase
      ? points.filter((p) => tokyoBarPhase(p.tsMs, ctx.chartYmd) === ctx.extendedPhase)
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

  const last =
    extended.length > 0
      ? extended[extended.length - 1]!.close
      : regular.length > 0
        ? regular[regular.length - 1]!.close
        : sessionClose;

  return { regular, extended, sessionClose, last };
}

export function formatTokyoGlancePointTime(tsMs: number | undefined): string {
  if (tsMs == null || !Number.isFinite(tsMs)) return "Time unavailable";
  const d = new Date(tsMs);
  const date = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: TOKYO_TZ,
  }).format(d);
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: TOKYO_TZ,
  }).format(d);
  return `${date} · ${time} JST`;
}

const LONDON_TZ = "Europe/London";
const LONDON_OPEN = 8 * 60;
const LONDON_CLOSE = 16 * 60 + 30;

export function londonYmd(tsMs: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: LONDON_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(tsMs));
}

export function londonYmdFromDate(now: Date): string {
  return londonYmd(now.getTime());
}

/** LSE cash session segment for a bar on a London calendar day. */
export function londonBarPhase(
  tsMs: number,
  ymd: string,
): "regular" | GlanceExtendedPhase | "other" {
  if (londonYmd(tsMs) !== ymd) return "other";
  const wd = tzWeekdayIso(tsMs, LONDON_TZ);
  if (wd < 1 || wd > 5) return "other";
  const mins = tzMinutesSinceMidnight(tsMs, LONDON_TZ);
  if (mins >= LONDON_OPEN && mins < LONDON_CLOSE) return "regular";
  if (mins < LONDON_OPEN) return "pre";
  if (mins >= LONDON_CLOSE) return "post";
  return "other";
}

export function isLondonCashSessionOpen(now: Date = new Date()): boolean {
  return londonBarPhase(now.getTime(), londonYmdFromDate(now)) === "regular";
}

function londonExtendedPhase(now: Date): GlanceExtendedPhase | null {
  const ymd = londonYmdFromDate(now);
  const wd = tzWeekdayIso(now.getTime(), LONDON_TZ);
  if (wd < 1 || wd > 5) return null;
  const phase = londonBarPhase(now.getTime(), ymd);
  if (phase === "pre" || phase === "post") return phase;
  return null;
}

function lastLondonSessionYmd(now: Date): string {
  if (isLondonCashSessionOpen(now)) return londonYmdFromDate(now);

  let cursor = now;
  for (let i = 0; i < 12; i++) {
    const ymd = londonYmd(cursor.getTime());
    const wd = tzWeekdayIso(cursor.getTime(), LONDON_TZ);
    if (wd >= 1 && wd <= 5) {
      const isToday = ymd === londonYmdFromDate(now);
      if (!isToday) return ymd;
      if (tzMinutesSinceMidnight(now.getTime(), LONDON_TZ) >= LONDON_CLOSE) return ymd;
    }
    cursor = new Date(cursor.getTime() - 24 * 60 * 60 * 1000);
  }
  return londonYmdFromDate(now);
}

export function londonGlanceChartContext(now: Date = new Date()): GlanceChartContext {
  const today = londonYmdFromDate(now);
  const extendedPhase = londonExtendedPhase(now);

  if (isLondonCashSessionOpen(now)) {
    return { sessionYmd: today, chartYmd: today, extendedPhase: null, showExtended: false };
  }

  if (extendedPhase === "post") {
    return { sessionYmd: today, chartYmd: today, extendedPhase: "post", showExtended: true };
  }

  if (extendedPhase === "pre") {
    return {
      sessionYmd: lastLondonSessionYmd(now),
      chartYmd: today,
      extendedPhase: "pre",
      showExtended: true,
    };
  }

  const sessionYmd = lastLondonSessionYmd(now);
  return { sessionYmd, chartYmd: sessionYmd, extendedPhase: null, showExtended: false };
}

export function resolveLondonSplitContext(
  ctx: GlanceChartContext,
  points: TimedClosePoint[],
): GlanceChartContext {
  if (ctx.showExtended && ctx.extendedPhase) return ctx;

  const ymd = ctx.chartYmd;
  const hasPost = points.some((p) => londonBarPhase(p.tsMs, ymd) === "post");
  if (hasPost) {
    return { ...ctx, showExtended: true, extendedPhase: "post" };
  }

  const hasPre = points.some((p) => londonBarPhase(p.tsMs, ymd) === "pre");
  if (hasPre && ctx.sessionYmd !== ymd) {
    return { ...ctx, showExtended: true, extendedPhase: "pre" };
  }

  return ctx;
}

export function splitTimedPointsForLondonCashIndexGlance(
  points: TimedClosePoint[],
  ctx: GlanceChartContext,
): {
  regular: GlanceSeriesPoint[];
  extended: GlanceSeriesPoint[];
  sessionClose: number | null;
  last: number | null;
} {
  const regularPts = points.filter((p) => londonBarPhase(p.tsMs, ctx.sessionYmd) === "regular");
  const extendedPts =
    ctx.showExtended && ctx.extendedPhase
      ? points.filter((p) => londonBarPhase(p.tsMs, ctx.chartYmd) === ctx.extendedPhase)
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

  const last =
    extended.length > 0
      ? extended[extended.length - 1]!.close
      : regular.length > 0
        ? regular[regular.length - 1]!.close
        : sessionClose;

  return { regular, extended, sessionClose, last };
}

export function formatLondonGlancePointTime(tsMs: number | undefined): string {
  if (tsMs == null || !Number.isFinite(tsMs)) return "Time unavailable";
  const d = new Date(tsMs);
  const date = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: LONDON_TZ,
  }).format(d);
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: LONDON_TZ,
  }).format(d);
  return `${date} · ${time} UK`;
}

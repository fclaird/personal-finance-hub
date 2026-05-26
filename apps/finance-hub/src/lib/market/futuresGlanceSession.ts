import { subtractNyCalendarDays } from "@/lib/market/glanceSession";
import type { GlanceExtendedPhase, GlanceSeriesPoint, TimedClosePoint } from "@/lib/market/glanceExtendedHours";
import { nyMinutesSinceMidnight, nyWeekdayIso, nyYmd } from "@/lib/market/usEquitySession";
import type { RegionalMarketInstrument } from "@/lib/market/regionalMarketInstruments";

export type FuturesGlanceKind = "cme_equity_index" | "asia_cash_index";

/** CME E-mini equity index futures: Sun 6pm ET – Fri 5pm ET; daily halt 5–6pm ET Mon–Fri. */
export type CmeFuturesPhase = "tradable" | "maintenance" | "closed";

const CME_SESSION_OPEN = 18 * 60;
const CME_SESSION_CLOSE = 17 * 60;
const CME_MAINT_END = 18 * 60;

const TOKYO_OPEN = 9 * 60;
const TOKYO_CLOSE = 15 * 60;
const SEOUL_OPEN = 9 * 60;
const SEOUL_CLOSE = 15 * 60 + 30;

export function futuresGlanceKindForInstrument(_def: RegionalMarketInstrument): FuturesGlanceKind {
  return "cme_equity_index";
}

/** Wall-clock instant for a NY calendar date + minutes from midnight (handles DST). */
export function nyWallTimeMs(ymd: string, minutesSinceMidnight: number): number {
  const [y, m, d] = ymd.split("-").map(Number);
  let t = Date.UTC(y!, m! - 1, d!, 17, 0, 0);
  t += (minutesSinceMidnight - 12 * 60) * 60 * 1000;
  for (let i = 0; i < 10; i++) {
    const dt = new Date(t);
    if (nyYmd(dt) === ymd && nyMinutesSinceMidnight(dt) === minutesSinceMidnight) return t;
    const deltaMin = minutesSinceMidnight - nyMinutesSinceMidnight(dt);
    t += deltaMin * 60 * 1000;
    const gotYmd = nyYmd(dt);
    if (gotYmd !== ymd) {
      t += (ymd > gotYmd ? 1 : -1) * 24 * 60 * 60 * 1000;
    }
  }
  return t;
}

/** Phase of CME equity index futures at an instant (ES/NQ Globex schedule). */
export function cmeEquityIndexFuturesPhase(tsMs: number): CmeFuturesPhase {
  const d = new Date(tsMs);
  const wd = nyWeekdayIso(d);
  const mins = nyMinutesSinceMidnight(d);

  if (wd === 6) return "closed";
  if (wd === 7 && mins < CME_SESSION_OPEN) return "closed";
  if (wd === 5 && mins >= CME_SESSION_CLOSE) return "closed";

  if (wd >= 1 && wd <= 5 && mins >= CME_SESSION_CLOSE && mins < CME_MAINT_END) {
    return "maintenance";
  }

  return "tradable";
}

export function isCmeEquityIndexFuturesTradable(now: Date = new Date()): boolean {
  return cmeEquityIndexFuturesPhase(now.getTime()) === "tradable";
}

function previousCmeSessionOpenMs(from: Date): number {
  let cursor = from;
  for (let i = 0; i < 8; i++) {
    cursor = subtractNyCalendarDays(cursor, 1);
    const wd = nyWeekdayIso(cursor);
    if (wd === 6) continue;
    return nyWallTimeMs(nyYmd(cursor), CME_SESSION_OPEN);
  }
  return nyWallTimeMs(nyYmd(from), CME_SESSION_OPEN);
}

/** Last completed CME session ended at the most recent weekday 5pm ET close. */
function cmeLastCompletedSessionStartMs(now: Date): number {
  let cursor = now;
  for (let i = 0; i < 10; i++) {
    const wd = nyWeekdayIso(cursor);
    const mins = nyMinutesSinceMidnight(cursor);
    if (wd === 5 && mins >= CME_SESSION_CLOSE) {
      const thu = subtractNyCalendarDays(cursor, 1);
      return nyWallTimeMs(nyYmd(thu), CME_SESSION_OPEN);
    }
    cursor = subtractNyCalendarDays(cursor, 1);
  }
  return previousCmeSessionOpenMs(now);
}

function cmeLastCompletedSessionEndMs(now: Date): number {
  let cursor = now;
  for (let i = 0; i < 10; i++) {
    const wd = nyWeekdayIso(cursor);
    const mins = nyMinutesSinceMidnight(cursor);
    if (wd >= 1 && wd <= 5 && mins >= CME_SESSION_CLOSE) {
      return nyWallTimeMs(nyYmd(cursor), CME_SESSION_CLOSE);
    }
    cursor = subtractNyCalendarDays(cursor, 1);
  }
  return now.getTime();
}

/** Start of the active (or last completed) CME trading session for charting. */
export function cmeFuturesSessionStartMs(now: Date = new Date()): number {
  const phase = cmeEquityIndexFuturesPhase(now.getTime());
  const wd = nyWeekdayIso(now);
  const mins = nyMinutesSinceMidnight(now);
  const ymd = nyYmd(now);

  if (phase === "closed") {
    if (wd === 6 || (wd === 7 && mins < CME_SESSION_OPEN) || (wd === 5 && mins >= CME_SESSION_CLOSE)) {
      return cmeLastCompletedSessionStartMs(now);
    }
  }

  if (phase === "maintenance") {
    return previousCmeSessionOpenMs(now);
  }

  if (mins >= CME_SESSION_OPEN) {
    return nyWallTimeMs(ymd, CME_SESSION_OPEN);
  }

  return previousCmeSessionOpenMs(now);
}

export function cmeFuturesSessionEndMs(now: Date = new Date()): number {
  const phase = cmeEquityIndexFuturesPhase(now.getTime());
  const nowMs = now.getTime();
  if (phase === "tradable") return nowMs;
  if (phase === "maintenance") return nyWallTimeMs(nyYmd(now), CME_SESSION_CLOSE);
  return cmeLastCompletedSessionEndMs(now);
}

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

function tzYmd(tsMs: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(tsMs));
}

export function asiaCashIndexPhase(
  tsMs: number,
  timeZone: "Asia/Tokyo" | "Asia/Seoul",
): "tradable" | "closed" {
  const wd = tzWeekdayIso(tsMs, timeZone);
  if (wd < 1 || wd > 5) return "closed";
  const mins = tzMinutesSinceMidnight(tsMs, timeZone);
  const open = timeZone === "Asia/Tokyo" ? TOKYO_OPEN : SEOUL_OPEN;
  const close = timeZone === "Asia/Tokyo" ? TOKYO_CLOSE : SEOUL_CLOSE;
  if (mins >= open && mins < close) return "tradable";
  return "closed";
}

export function asiaCashSessionYmd(now: Date, timeZone: "Asia/Tokyo" | "Asia/Seoul"): string {
  const localYmd = tzYmd(now.getTime(), timeZone);
  if (asiaCashIndexPhase(now.getTime(), timeZone) === "tradable") return localYmd;

  let cursor = now;
  for (let i = 0; i < 10; i++) {
    cursor = new Date(cursor.getTime() - 24 * 60 * 60 * 1000);
    const ymd = tzYmd(cursor.getTime(), timeZone);
    const wd = tzWeekdayIso(cursor.getTime(), timeZone);
    if (wd >= 1 && wd <= 5) return ymd;
  }
  return localYmd;
}

export function isAsiaCashIndexTradable(
  now: Date,
  timeZone: "Asia/Tokyo" | "Asia/Seoul",
): boolean {
  return asiaCashIndexPhase(now.getTime(), timeZone) === "tradable";
}

export function isFuturesInstrumentTradable(
  kind: FuturesGlanceKind,
  region: RegionalMarketInstrument["region"],
  now: Date = new Date(),
): boolean {
  if (kind === "cme_equity_index") return isCmeEquityIndexFuturesTradable(now);
  const tz = region === "jp" ? "Asia/Tokyo" : "Asia/Seoul";
  return isAsiaCashIndexTradable(now, tz);
}

export function futuresSegmentLabel(kind: FuturesGlanceKind, segment: "prior" | "regular" | "extended"): string {
  if (segment === "prior") return "Prior settlement";
  if (segment === "extended") return kind === "cme_equity_index" ? "Market halt" : "Closed";
  return kind === "cme_equity_index" ? "Globex session" : "Cash session";
}

export function futuresExtendedPhaseLabel(
  phase: GlanceExtendedPhase | null | undefined,
  kind: FuturesGlanceKind,
): string {
  if (kind === "cme_equity_index") return phase === "pre" ? "Overnight" : "Market halt";
  return phase === "pre" ? "Pre-open" : "Closed";
}

function splitCmeTimedPoints(points: TimedClosePoint[], now: Date): {
  regular: GlanceSeriesPoint[];
  extended: GlanceSeriesPoint[];
  sessionClose: number | null;
  extendedPhase: GlanceExtendedPhase | null;
  last: number | null;
} {
  const sessionStart = cmeFuturesSessionStartMs(now);
  const sessionEnd = cmeFuturesSessionEndMs(now);

  const tradablePts = points
    .filter((p) => {
      if (p.tsMs < sessionStart || p.tsMs > sessionEnd) return false;
      return cmeEquityIndexFuturesPhase(p.tsMs) === "tradable";
    })
    .sort((a, b) => a.tsMs - b.tsMs);

  const haltPts = points
    .filter((p) => {
      if (p.tsMs < sessionStart || p.tsMs > now.getTime()) return false;
      const phase = cmeEquityIndexFuturesPhase(p.tsMs);
      return phase === "maintenance" || phase === "closed";
    })
    .sort((a, b) => a.tsMs - b.tsMs);

  const regular = tradablePts.map((p, idx) => ({ idx, close: p.close, tsMs: p.tsMs }));
  const sessionClose = regular.length > 0 ? regular[regular.length - 1]!.close : null;
  const last = sessionClose;

  let extended: GlanceSeriesPoint[] = [];
  let extendedPhase: GlanceExtendedPhase | null = null;

  if (haltPts.length >= 2 && sessionClose != null) {
    const startIdx = regular.length > 0 ? regular.length - 1 : 0;
    extended = [{ idx: startIdx, close: sessionClose, tsMs: tradablePts[tradablePts.length - 1]?.tsMs }];
    for (let i = 0; i < haltPts.length; i++) {
      extended.push({
        idx: startIdx + 1 + i,
        close: haltPts[i]!.close,
        tsMs: haltPts[i]!.tsMs,
      });
    }
    if (extended.length >= 2) extendedPhase = "post";
  }

  return { regular, extended, sessionClose, extendedPhase, last };
}

function splitAsiaTimedPoints(
  points: TimedClosePoint[],
  timeZone: "Asia/Tokyo" | "Asia/Seoul",
  now: Date,
): {
  regular: GlanceSeriesPoint[];
  extended: GlanceSeriesPoint[];
  sessionClose: number | null;
  extendedPhase: GlanceExtendedPhase | null;
  last: number | null;
} {
  const sessionYmd = asiaCashSessionYmd(now, timeZone);
  const tradablePts = points
    .filter((p) => tzYmd(p.tsMs, timeZone) === sessionYmd && asiaCashIndexPhase(p.tsMs, timeZone) === "tradable")
    .sort((a, b) => a.tsMs - b.tsMs);

  const regular = tradablePts.map((p, idx) => ({ idx, close: p.close, tsMs: p.tsMs }));
  const sessionClose = regular.length > 0 ? regular[regular.length - 1]!.close : null;

  return {
    regular,
    extended: [],
    sessionClose,
    extendedPhase: null,
    last: sessionClose,
  };
}

export function splitTimedPointsForFuturesGlance(
  points: TimedClosePoint[],
  kind: FuturesGlanceKind,
  region: RegionalMarketInstrument["region"],
  now: Date,
): {
  regular: GlanceSeriesPoint[];
  extended: GlanceSeriesPoint[];
  sessionClose: number | null;
  extendedPhase: GlanceExtendedPhase | null;
  last: number | null;
} {
  if (kind === "cme_equity_index") return splitCmeTimedPoints(points, now);
  const tz = region === "jp" ? "Asia/Tokyo" : "Asia/Seoul";
  return splitAsiaTimedPoints(points, tz, now);
}

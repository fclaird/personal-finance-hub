import {
  isNyseHolidayYmd,
  isUsEquityRegularSessionOpen,
  nyMinutesSinceMidnight,
  nyWeekdayIso,
  nyYmd,
} from "@/lib/market/usEquitySession";

const NY_TZ = "America/New_York";

export function isoDateInUsEastern(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: NY_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

export function subtractNyCalendarDays(from: Date, days: number): Date {
  const ymd = nyYmd(from);
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! - days, 17, 0, 0));
}

/**
 * US equity session whose intraday path quick-glance should display.
 * During RTH: today. Otherwise: last completed session (e.g. prior Friday on weekends).
 */
export function glanceSessionYmd(now: Date = new Date()): string {
  if (isUsEquityRegularSessionOpen(now)) return nyYmd(now);

  let cursor = now;
  for (let i = 0; i < 12; i++) {
    const ymd = nyYmd(cursor);
    const wd = nyWeekdayIso(cursor);
    if (wd >= 1 && wd <= 5 && !isNyseHolidayYmd(ymd)) {
      const isToday = ymd === nyYmd(now);
      if (!isToday) return ymd;
      if (nyMinutesSinceMidnight(now) >= 16 * 60) return ymd;
    }
    cursor = subtractNyCalendarDays(cursor, 1);
  }
  return nyYmd(now);
}

export function formatGlanceSessionLabel(sessionYmd: string): string {
  const [y, m, d] = sessionYmd.split("-").map(Number);
  const noonUtc = new Date(Date.UTC(y!, m! - 1, d!, 12, 0, 0));
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: NY_TZ,
  }).format(noonUtc);
}

export function glanceSessionUsesPriorDay(now: Date = new Date()): boolean {
  return glanceSessionYmd(now) !== nyYmd(now);
}

export function yahooIntradayRangeForGlance(now: Date = new Date()): "1d" | "5d" {
  return isUsEquityRegularSessionOpen(now) ? "1d" : "5d";
}

export function schwabIntradayWindowForGlance(now: Date = new Date()): "1D" | "5D" {
  return isUsEquityRegularSessionOpen(now) ? "1D" : "5D";
}

export function filterSeriesToSessionYmd<T extends { tsMs: number }>(
  rows: T[],
  sessionYmd: string,
): T[] {
  return rows.filter((r) => isoDateInUsEastern(r.tsMs) === sessionYmd);
}

export function toIndexedSeries(closes: number[]): Array<{ idx: number; close: number }> {
  return closes.map((close, idx) => ({ idx, close }));
}

export function filterYahooClosesToSession(
  result: Record<string, unknown>,
  sessionYmd: string,
): Array<{ idx: number; close: number }> {
  const quote = (result.indicators as Record<string, unknown> | undefined)?.quote as
    | Array<Record<string, unknown>>
    | undefined;
  const q0 = quote?.[0];
  const closes = (q0?.close as Array<number | null> | undefined) ?? [];
  const timestamps = (result.timestamp as number[] | undefined) ?? [];

  const points: Array<{ idx: number; close: number }> = [];
  for (let i = 0; i < closes.length; i++) {
    const c = closes[i];
    if (c == null || !Number.isFinite(c)) continue;
    const ts = timestamps[i];
    if (ts != null) {
      const day = isoDateInUsEastern(ts * 1000);
      if (day !== sessionYmd) continue;
    }
    points.push({ idx: points.length, close: c });
  }
  return points;
}

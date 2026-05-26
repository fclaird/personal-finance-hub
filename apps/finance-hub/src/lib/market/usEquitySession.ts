/**
 * US equity regular session (NYSE) in America/New_York: Mon–Fri 09:30–16:00,
 * excluding NYSE holidays (calendar dates, US observance).
 */

const NY_TZ = "America/New_York";

/** Minutes from midnight in NY wall time for a given instant. */
export function nyMinutesSinceMidnight(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: NY_TZ,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(now);
  let h = 0;
  let m = 0;
  for (const p of parts) {
    if (p.type === "hour") h = Number(p.value);
    if (p.type === "minute") m = Number(p.value);
  }
  return h * 60 + m;
}

/** YYYY-MM-DD in New York for the given instant. */
export function nyYmd(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: NY_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Weekday in New York: 1 = Monday … 7 = Sunday */
export function nyWeekdayIso(now: Date): number {
  // en-US weekday short in NY timezone — map to ISO weekday
  const w = new Intl.DateTimeFormat("en-US", { timeZone: NY_TZ, weekday: "short" }).format(now);
  const map: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return map[w] ?? 0;
}

/** NYSE full-day closures (YYYY-MM-DD). Extend yearly. */
const NYSE_HOLIDAYS = new Set<string>([
  "2025-01-01",
  "2025-01-20",
  "2025-02-17",
  "2025-04-18",
  "2025-05-26",
  "2025-06-19",
  "2025-07-04",
  "2025-09-01",
  "2025-11-27",
  "2025-12-25",
  "2026-01-01",
  "2026-01-19",
  "2026-02-16",
  "2026-04-03",
  "2026-05-25",
  "2026-06-19",
  "2026-07-03",
  "2026-09-07",
  "2026-11-26",
  "2026-12-25",
  "2027-01-01",
  "2027-01-18",
  "2027-02-15",
  "2027-03-26",
  "2027-05-31",
  "2027-06-18",
  "2027-07-05",
  "2027-09-06",
  "2027-11-25",
  "2027-12-24",
]);

export function isNyseHolidayYmd(ymd: string): boolean {
  return NYSE_HOLIDAYS.has(ymd);
}

/** US equity RTH: weekday, not holiday, 09:30 <= t < 16:00 NY. */
export function isUsEquityRegularSessionOpen(now: Date = new Date()): boolean {
  const wd = nyWeekdayIso(now);
  if (wd < 1 || wd > 5) return false;
  const ymd = nyYmd(now);
  if (isNyseHolidayYmd(ymd)) return false;
  const mins = nyMinutesSinceMidnight(now);
  const open = 9 * 60 + 30;
  const close = 16 * 60;
  return mins >= open && mins < close;
}

/**
 * Weekday equity session day (Mon–Fri, not NYSE holiday): futures pre-open poll window
 * [09:30−60min, 09:30) NY == [08:30, 09:30).
 */
/** Human-readable US equity session status for market headers. */
export function usEquitySessionStatus(now: Date = new Date()): {
  headline: string;
  detail: string;
  isOpen: boolean;
} {
  const wd = nyWeekdayIso(now);
  const ymd = nyYmd(now);
  const mins = nyMinutesSinceMidnight(now);
  const open = 9 * 60 + 30;
  const close = 16 * 60;

  if (wd < 1 || wd > 5 || isNyseHolidayYmd(ymd)) {
    return { headline: "U.S. MARKETS CLOSED", detail: "Weekend or NYSE holiday", isOpen: false };
  }

  if (mins >= open && mins < close) {
    const left = close - mins;
    const h = Math.floor(left / 60);
    const m = left % 60;
    return {
      headline: `U.S. MARKETS CLOSE IN ${h} HR ${m} MIN`,
      detail: "Regular session 09:30–16:00 ET",
      isOpen: true,
    };
  }

  if (mins < open) {
    const left = open - mins;
    const h = Math.floor(left / 60);
    const m = left % 60;
    return {
      headline: `U.S. MARKETS OPEN IN ${h} HR ${m} MIN`,
      detail: "Pre-market",
      isOpen: false,
    };
  }

  return { headline: "U.S. MARKETS CLOSED", detail: "After 16:00 ET", isOpen: false };
}

export function isUsEquityPreOpenFuturesPollWindow(now: Date = new Date()): boolean {
  const wd = nyWeekdayIso(now);
  if (wd < 1 || wd > 5) return false;
  const ymd = nyYmd(now);
  if (isNyseHolidayYmd(ymd)) return false;
  const mins = nyMinutesSinceMidnight(now);
  const open = 9 * 60 + 30;
  const start = open - 60;
  return mins >= start && mins < open;
}

/** US index futures poll window: pre-open (08:30–09:30 ET) and after-hours (16:00–20:00 ET). */
export function isUsEquityExtendedFuturesPollWindow(now: Date = new Date()): boolean {
  if (isUsEquityPreOpenFuturesPollWindow(now)) return true;
  const wd = nyWeekdayIso(now);
  if (wd < 1 || wd > 5) return false;
  const ymd = nyYmd(now);
  if (isNyseHolidayYmd(ymd)) return false;
  const mins = nyMinutesSinceMidnight(now);
  const close = 16 * 60;
  const end = 20 * 60;
  return mins >= close && mins < end;
}

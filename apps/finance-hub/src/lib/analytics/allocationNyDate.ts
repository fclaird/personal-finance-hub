import { nyWallTimeMs } from "@/lib/market/futuresGlanceSession";
import { isNyseHolidayYmd, nyMinutesSinceMidnight, nyWeekdayIso, nyYmd } from "@/lib/market/usEquitySession";

/** Cash-session close. Allocation history treats this instant as the daily close. */
export const ALLOCATION_CLOSE_MINUTES = 16 * 60;

/** YYYY-MM-DD in America/New_York for the given instant. */
export function nyCalendarIso(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Weekday short name in NY for `d`. */
function nyWeekdayShort(d: Date): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short" }).format(d);
}

/**
 * Last NY calendar date that is not Sat/Sun, walking backward from `from` (inclusive).
 * This is the calendar weekday, including an open session. It is not the cash close.
 */
export function lastCompletedNyWeekday(from: Date = new Date()): string {
  let t = from.getTime();
  for (let i = 0; i < 14; i++) {
    const d = new Date(t);
    const wd = nyWeekdayShort(d);
    if (wd !== "Sat" && wd !== "Sun") return nyCalendarIso(d);
    t -= 86400000;
  }
  return nyCalendarIso(from);
}

/**
 * NY session whose cash close is allowed to be snapshotted from the live book.
 * Null before 16:00 ET, on weekends, and on full-day NYSE holidays — a later
 * sync must not stamp Sunday's marks onto Friday.
 */
export function allocationDailyCloseTradeDate(now: Date = new Date()): string | null {
  const wd = nyWeekdayIso(now);
  if (wd < 1 || wd > 5) return null;
  const ymd = nyYmd(now);
  if (isNyseHolidayYmd(ymd)) return null;
  if (nyMinutesSinceMidnight(now) < ALLOCATION_CLOSE_MINUTES) return null;
  return ymd;
}

/** SQLite `datetime('now')` and ISO strings, both read as UTC. */
export function sqliteUtcMs(createdAt: string): number {
  const trimmed = createdAt.trim();
  if (!trimmed) return Number.NaN;
  if (/[zZ]$/.test(trimmed) || /[+-]\d{2}:\d{2}$/.test(trimmed)) return Date.parse(trimmed);
  const iso = trimmed.includes("T") ? trimmed : trimmed.replace(" ", "T");
  return Date.parse(`${iso}Z`);
}

/**
 * Write the live book onto `tradeDate` only for today's finished cash session,
 * and only when the stored row (if any) was taken before 16:00 ET.
 * A row stamped at or after the close stays. That keeps the first post-close
 * snapshot when later syncs see collapsed option marks.
 */
export function shouldWriteAllocationDailyClose(
  now: Date,
  tradeDate: string,
  existingCreatedAt: string | null,
): boolean {
  const stamp = allocationDailyCloseTradeDate(now);
  if (stamp == null || stamp !== tradeDate) return false;
  if (!existingCreatedAt) return true;
  const createdMs = sqliteUtcMs(existingCreatedAt);
  if (!Number.isFinite(createdMs)) return true;
  return createdMs < nyWallTimeMs(tradeDate, ALLOCATION_CLOSE_MINUTES);
}

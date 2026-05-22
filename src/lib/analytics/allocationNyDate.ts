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
 * Used as default "daily close" session date (v1: no exchange holiday table).
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

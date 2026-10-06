import { nyWallTimeMs } from "@/lib/market/futuresGlanceSession";
import { nyMinutesSinceMidnight, nyWeekdayIso, nyYmd } from "@/lib/market/usEquitySession";

/**
 * Reports calendar in America/New_York.
 *
 * A futures week opens Sunday at 18:00 inclusive and closes the next Sunday at 18:00
 * exclusive. A clock time in that opening hour belongs on Monday. A trade date with no
 * clock is noon that calendar day, so a bare Sunday stays on the Sunday row.
 *
 * Totals for a week, the last five weeks, and a month always include Saturday and
 * Sunday-before-18:00 trades. On the weekly tab, Show weekend hides Saturday and
 * Sunday rows and does not change the week total.
 */

export const FUTURES_OPEN_MINUTES = 18 * 60;

const WEEKDAY_FROM_MONDAY = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

export type WeekdayName = (typeof WEEKDAY_FROM_MONDAY)[number];

export const ROLLING_WEEK_LABELS = [
  "This week",
  "Last week",
  "2 weeks ago",
  "3 weeks ago",
  "4 weeks ago",
] as const;

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export type SessionTrade = {
  tradeDate: string;
  tradedAt?: string | null;
};

export type FuturesDaySlot = {
  ymd: string;
  weekday: WeekdayName;
  weekend: boolean;
};

export type FuturesWeek = {
  mondayYmd: string;
  openSundayYmd: string;
  closeSundayYmd: string;
  opensAtMs: number;
  closesAtMs: number;
  days: FuturesDaySlot[];
};

export type ClippedMonthWeek = {
  weekNumber: number;
  week: FuturesWeek;
  clippedStartYmd: string;
  clippedEndYmd: string;
  clippedDays: FuturesDaySlot[];
};

export type YtdMonth = {
  key: string;
  label: string;
  year: number;
  month: number;
};

export function addCalendarDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! + days));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function utcWeekday(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
}

export function lastDayOfMonthYmd(year: number, month: number): string {
  const dt = new Date(Date.UTC(year, month, 0));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** Monday of the futures week that owns this session calendar date. */
export function mondayOfSessionYmd(sessionYmd: string): string {
  const dow = utcWeekday(sessionYmd);
  const sinceMonday = dow === 0 ? 6 : dow - 1;
  return addCalendarDays(sessionYmd, -sinceMonday);
}

/** Session calendar date. Sunday at or after 18:00 ET rolls to Monday. */
export function futuresSessionYmd(at: Date): string {
  const ymd = nyYmd(at);
  if (nyWeekdayIso(at) === 7 && nyMinutesSinceMidnight(at) >= FUTURES_OPEN_MINUTES) {
    return addCalendarDays(ymd, 1);
  }
  return ymd;
}

export function instantForTrade(trade: SessionTrade): Date | null {
  if (trade.tradedAt) {
    const parsed = new Date(trade.tradedAt);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(trade.tradeDate)) {
    return new Date(nyWallTimeMs(trade.tradeDate, 12 * 60));
  }
  return null;
}

export function sessionYmdForTrade(trade: SessionTrade): string {
  const instant = instantForTrade(trade);
  if (!instant) return trade.tradeDate.slice(0, 10);
  return futuresSessionYmd(instant);
}

function daysFromMonday(mondayYmd: string): FuturesDaySlot[] {
  return WEEKDAY_FROM_MONDAY.map((weekday, index) => ({
    ymd: addCalendarDays(mondayYmd, index),
    weekday,
    weekend: index >= 5,
  }));
}

export function futuresWeekByMonday(mondayYmd: string): FuturesWeek {
  const openSundayYmd = addCalendarDays(mondayYmd, -1);
  const closeSundayYmd = addCalendarDays(mondayYmd, 6);
  return {
    mondayYmd,
    openSundayYmd,
    closeSundayYmd,
    opensAtMs: nyWallTimeMs(openSundayYmd, FUTURES_OPEN_MINUTES),
    closesAtMs: nyWallTimeMs(closeSundayYmd, FUTURES_OPEN_MINUTES),
    days: daysFromMonday(mondayYmd),
  };
}

export function futuresWeekContaining(at: Date): FuturesWeek {
  return futuresWeekByMonday(mondayOfSessionYmd(futuresSessionYmd(at)));
}

/** Newest week first. Each block is a whole futures week, not clipped to a month. */
export function rollingFuturesWeeks(now: Date, count = 5): FuturesWeek[] {
  const currentMonday = futuresWeekContaining(now).mondayYmd;
  const weeks: FuturesWeek[] = [];
  for (let i = 0; i < count; i++) {
    weeks.push(futuresWeekByMonday(addCalendarDays(currentMonday, -7 * i)));
  }
  return weeks;
}

export function tradeFallsInWeeks(trade: SessionTrade, weeks: readonly FuturesWeek[]): boolean {
  const monday = mondayOfSessionYmd(sessionYmdForTrade(trade));
  return weeks.some((week) => week.mondayYmd === monday);
}

export function clippedMonthWeeks(year: number, month: number): ClippedMonthWeek[] {
  const monthStart = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`;
  const monthEnd = lastDayOfMonthYmd(year, month);
  let monday = mondayOfSessionYmd(monthStart);
  const weeks: ClippedMonthWeek[] = [];
  while (monday <= monthEnd && weeks.length < 6) {
    const week = futuresWeekByMonday(monday);
    const clippedDays = week.days.filter((day) => day.ymd >= monthStart && day.ymd <= monthEnd);
    if (clippedDays.length > 0) {
      weeks.push({
        weekNumber: weeks.length + 1,
        week,
        clippedStartYmd: clippedDays[0]!.ymd,
        clippedEndYmd: clippedDays[clippedDays.length - 1]!.ymd,
        clippedDays,
      });
    }
    monday = addCalendarDays(monday, 7);
  }
  return weeks;
}

export function ytdMonthsThrough(now: Date): YtdMonth[] {
  const ymd = nyYmd(now);
  const year = Number(ymd.slice(0, 4));
  const month = Number(ymd.slice(5, 7));
  const months: YtdMonth[] = [];
  for (let m = 1; m <= month; m++) {
    months.push({
      key: `${year}-${String(m).padStart(2, "0")}`,
      label: MONTH_NAMES[m - 1]!,
      year,
      month: m,
    });
  }
  return months;
}

/**
 * Calendar month of the session date. A Sunday evening that rolls into a month
 * after `throughYmd` stays on the through month so the year-to-date rows still
 * add up before that next month is on the calendar.
 */
export function monthKeyForTrade(trade: SessionTrade, throughYmd: string): string {
  const sessionMonth = sessionYmdForTrade(trade).slice(0, 7);
  const through = throughYmd.slice(0, 7);
  return sessionMonth > through ? through : sessionMonth;
}

export function spillSessionYmds(trades: readonly SessionTrade[], throughYmd: string): string[] {
  const through = throughYmd.slice(0, 7);
  const seen = new Set<string>();
  for (const trade of trades) {
    const session = sessionYmdForTrade(trade);
    if (session.slice(0, 7) > through && monthKeyForTrade(trade, throughYmd) === through) {
      seen.add(session);
    }
  }
  return [...seen].sort();
}

export function weekendSessionTrades<T extends SessionTrade>(
  trades: readonly T[],
  days: readonly FuturesDaySlot[],
): T[] {
  const weekend = new Set(days.filter((day) => day.weekend).map((day) => day.ymd));
  return trades.filter((trade) => weekend.has(sessionYmdForTrade(trade)));
}

export function daySlotsForDisplay(days: readonly FuturesDaySlot[], showWeekend: boolean): FuturesDaySlot[] {
  return showWeekend ? [...days] : days.filter((day) => !day.weekend);
}

function shortMonthDay(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!, 12)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function formatWeekdayDateLabel(ymd: string): string {
  const name = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][utcWeekday(ymd)];
  return `${name}, ${shortMonthDay(ymd)}`;
}

export function formatMonthDayRange(startYmd: string, endYmd: string): string {
  if (startYmd === endYmd) return shortMonthDay(startYmd);
  const startYear = startYmd.slice(0, 4);
  const endYear = endYmd.slice(0, 4);
  if (startYear === endYear) return `${shortMonthDay(startYmd)} \u2013 ${shortMonthDay(endYmd)}`;
  return `${shortMonthDay(startYmd)}, ${startYear} \u2013 ${shortMonthDay(endYmd)}, ${endYear}`;
}

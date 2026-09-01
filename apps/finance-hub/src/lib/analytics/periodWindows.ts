import { glanceSessionYmd, subtractNyCalendarDays } from "@/lib/market/glanceSession";
import { isNyseHolidayYmd, nyWeekdayIso, nyYmd } from "@/lib/market/usEquitySession";

export type PeriodKind = "daily" | "weekly" | "monthly" | "ytd";

export const PERIOD_KINDS: PeriodKind[] = ["daily", "weekly", "monthly", "ytd"];

export type PeriodWindow = {
  period: PeriodKind;
  /** Inclusive NY calendar start of the reporting window (trades, labels). */
  startYmd: string;
  /** Inclusive NY calendar end (typically today in New York). */
  endYmd: string;
  /** Last trading day on or before the day before `startYmd` — portfolio P&L baseline. */
  startAnchorYmd: string;
};

export function isNyTradingDayYmd(ymd: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(5, 7)) - 1;
  const d = Number(ymd.slice(8, 10));
  const dow = new Date(Date.UTC(y, m, d)).getUTCDay();
  if (dow === 0 || dow === 6) return false;
  return !isNyseHolidayYmd(ymd);
}

/** Previous NYSE trading session strictly before `fromYmd`. */
export function priorTradingDayYmd(fromYmd: string): string {
  const [y, m, d] = fromYmd.split("-").map(Number);
  let cursor = new Date(Date.UTC(y!, m! - 1, d!, 17, 0, 0));
  for (let i = 0; i < 366; i++) {
    cursor = subtractNyCalendarDays(cursor, 1);
    const ymd = nyYmd(cursor);
    if (isNyTradingDayYmd(ymd)) return ymd;
  }
  return fromYmd;
}

function nyWeekStartYmd(now: Date): string {
  const wd = nyWeekdayIso(now);
  const daysFromMonday = wd - 1;
  return nyYmd(subtractNyCalendarDays(now, daysFromMonday));
}

function nyMonthStartYmd(now: Date): string {
  const ymd = nyYmd(now);
  return `${ymd.slice(0, 7)}-01`;
}

function nyYearStartYmd(now: Date): string {
  const ymd = nyYmd(now);
  return `${ymd.slice(0, 4)}-01-01`;
}

export function resolvePeriodWindow(period: PeriodKind, now: Date = new Date()): PeriodWindow {
  const todayYmd = nyYmd(now);

  if (period === "daily") {
    const sessionYmd = glanceSessionYmd(now);
    return {
      period,
      startYmd: sessionYmd,
      endYmd: sessionYmd,
      startAnchorYmd: priorTradingDayYmd(sessionYmd),
    };
  }

  const startYmd =
    period === "weekly"
      ? nyWeekStartYmd(now)
      : period === "monthly"
        ? nyMonthStartYmd(now)
        : nyYearStartYmd(now);

  return {
    period,
    startYmd,
    endYmd: todayYmd,
    startAnchorYmd: priorTradingDayYmd(startYmd),
  };
}

export function parsePeriodKind(raw: string | null | undefined): PeriodKind | null {
  const v = (raw ?? "").trim().toLowerCase();
  return PERIOD_KINDS.includes(v as PeriodKind) ? (v as PeriodKind) : null;
}

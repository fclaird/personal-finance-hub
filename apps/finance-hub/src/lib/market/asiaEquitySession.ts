const TOKYO_TZ = "Asia/Tokyo";
const SEOUL_TZ = "Asia/Seoul";

function tzYmd(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function tzWeekdayIso(now: Date, timeZone: string): number {
  const w = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(now);
  const map: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return map[w] ?? 0;
}

function tzMinutesSinceMidnight(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
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

function equitySessionStatus(
  now: Date,
  timeZone: string,
  marketName: string,
  openMin: number,
  closeMin: number,
): { headline: string; detail: string; isOpen: boolean; sessionYmd: string } {
  const wd = tzWeekdayIso(now, timeZone);
  const sessionYmd = tzYmd(now, timeZone);
  const mins = tzMinutesSinceMidnight(now, timeZone);

  if (wd < 1 || wd > 5) {
    return { headline: `${marketName} CLOSED`, detail: "Weekend", isOpen: false, sessionYmd };
  }

  if (mins >= openMin && mins < closeMin) {
    const left = closeMin - mins;
    const h = Math.floor(left / 60);
    const m = left % 60;
    return {
      headline: `${marketName} OPEN`,
      detail: `Closes in ${h}h ${m}m`,
      isOpen: true,
      sessionYmd,
    };
  }

  if (mins < openMin) {
    const left = openMin - mins;
    const h = Math.floor(left / 60);
    const m = left % 60;
    return {
      headline: `${marketName} PRE-OPEN`,
      detail: `Opens in ${h}h ${m}m`,
      isOpen: false,
      sessionYmd,
    };
  }

  return { headline: `${marketName} CLOSED`, detail: "After cash close", isOpen: false, sessionYmd };
}

/** Tokyo Stock Exchange cash session (approx. 09:00–15:00 JST). */
export function japanEquitySessionStatus(now: Date = new Date()) {
  return equitySessionStatus(now, TOKYO_TZ, "JAPAN", 9 * 60, 15 * 60);
}

/** Korea Exchange cash session (approx. 09:00–15:30 KST). */
export function koreaEquitySessionStatus(now: Date = new Date()) {
  return equitySessionStatus(now, SEOUL_TZ, "KOREA", 9 * 60, 15 * 60 + 30);
}

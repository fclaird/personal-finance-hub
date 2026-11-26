import type { ChartCandle, ChartInterval } from "@/lib/charts/types";

const OPEN_MIN = 9 * 60 + 30;
const CLOSE_MIN = 16 * 60;

export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, (m ?? 1) - 1, (d ?? 1) + days));
  return dt.toISOString().slice(0, 10);
}

export function addMonthsIso(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, (m ?? 1) - 1 + months, d ?? 1));
  return dt.toISOString().slice(0, 10);
}

function weekdayUtc(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1)).getUTCDay();
}

export function addBusinessDays(iso: string, days: number): string {
  let cursor = iso;
  let left = Math.max(0, days);
  while (left > 0) {
    cursor = addDaysIso(cursor, 1);
    const wd = weekdayUtc(cursor);
    if (wd !== 0 && wd !== 6) left -= 1;
  }
  return cursor;
}

export function sessionDate(tsSec: number, timeZone = "America/New_York"): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(tsSec * 1000));
}

export type NyParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  minutes: number;
  weekday: string;
  date: string;
};

export function nyParts(tsSec: number): NyParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  });
  const map: Record<string, string> = {};
  for (const part of fmt.formatToParts(new Date(tsSec * 1000))) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  let hour = Number(map.hour);
  if (hour === 24) hour = 0;
  const year = Number(map.year);
  const month = Number(map.month);
  const day = Number(map.day);
  const minute = Number(map.minute);
  const date = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return {
    year,
    month,
    day,
    hour,
    minute,
    minutes: hour * 60 + minute,
    weekday: map.weekday ?? "",
    date,
  };
}

/** UTC unix seconds for a New York civil time. */
export function zonedUtcSeconds(year: number, month: number, day: number, hour: number, minute: number): number {
  const desired = Date.UTC(year, month - 1, day, hour, minute);
  let utc = desired;
  for (let i = 0; i < 3; i++) {
    const got = nyParts(Math.round(utc / 1000));
    const gotMs = Date.UTC(got.year, got.month - 1, got.day, got.hour, got.minute);
    const next = utc - (gotMs - desired);
    if (next === utc) break;
    utc = next;
  }
  return Math.round(utc / 1000);
}

function addCalendarDays(year: number, month: number, day: number, days: number) {
  const dt = new Date(Date.UTC(year, month - 1, day + days));
  return { year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate() };
}

/** Next regular-session bar start after `tsSec`, stepping `stepMin` minutes. */
export function nextRegularBar(tsSec: number, stepMin: number): number {
  const candidate = tsSec + stepMin * 60;
  const p = nyParts(candidate);
  const weekend = p.weekday === "Sat" || p.weekday === "Sun";
  if (!weekend && p.minutes >= OPEN_MIN && p.minutes < CLOSE_MIN) return candidate;
  let y = p.year;
  let m = p.month;
  let d = p.day;
  if (weekend || p.minutes >= OPEN_MIN) {
    const n = addCalendarDays(y, m, d, 1);
    y = n.year;
    m = n.month;
    d = n.day;
  }
  for (let i = 0; i < 4; i++) {
    const wd = nyParts(zonedUtcSeconds(y, m, d, 12, 0)).weekday;
    if (wd !== "Sat" && wd !== "Sun") break;
    const n = addCalendarDays(y, m, d, 1);
    y = n.year;
    m = n.month;
    d = n.day;
  }
  return zonedUtcSeconds(y, m, d, 9, 30);
}

/** NY session date while the bar is inside 9:30–16:00, otherwise null. */
export function regularSessionKey(tsSec: number): string | null {
  const p = nyParts(tsSec);
  if (p.weekday === "Sat" || p.weekday === "Sun") return null;
  if (p.minutes < OPEN_MIN || p.minutes >= CLOSE_MIN) return null;
  return p.date;
}

export function futureTimes(last: ChartCandle["time"], interval: ChartInterval, count: number): Array<ChartCandle["time"]> {
  const out: Array<ChartCandle["time"]> = [];
  if (count <= 0) return out;
  if (interval === "1d") {
    let cursor = String(last);
    for (let i = 0; i < count; i++) {
      cursor = addBusinessDays(cursor, 1);
      out.push(cursor);
    }
    return out;
  }
  if (interval === "1wk") {
    let cursor = String(last);
    for (let i = 0; i < count; i++) {
      cursor = addDaysIso(cursor, 7);
      out.push(cursor);
    }
    return out;
  }
  if (interval === "1mo") {
    let cursor = String(last);
    for (let i = 0; i < count; i++) {
      cursor = addMonthsIso(cursor, 1);
      out.push(cursor);
    }
    return out;
  }
  const step = interval === "5m" ? 5 : interval === "15m" ? 15 : 60;
  let cursor = Number(last);
  for (let i = 0; i < count; i++) {
    cursor = nextRegularBar(cursor, step);
    out.push(cursor);
  }
  return out;
}

export function aggregateCandles(candles: readonly ChartCandle[], interval: "1wk" | "1mo"): ChartCandle[] {
  const groups = new Map<string, ChartCandle>();
  for (const bar of candles) {
    if (typeof bar.time !== "string") continue;
    const key = interval === "1wk" ? mondayOf(bar.time) : `${bar.time.slice(0, 7)}-01`;
    const prev = groups.get(key);
    if (!prev) {
      groups.set(key, { time: key, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume });
      continue;
    }
    prev.high = Math.max(prev.high, bar.high);
    prev.low = Math.min(prev.low, bar.low);
    prev.close = bar.close;
    prev.volume += bar.volume;
  }
  return [...groups.values()];
}

function mondayOf(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1));
  const day = dt.getUTCDay();
  const delta = day === 0 ? -6 : 1 - day;
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

export function latestSessionBars<T extends { time: number }>(bars: readonly T[]): T[] {
  let latest: string | null = null;
  const keys = bars.map((bar) => regularSessionKey(bar.time));
  for (let i = keys.length - 1; i >= 0; i--) {
    if (keys[i]) {
      latest = keys[i]!;
      break;
    }
  }
  if (!latest) return [];
  return bars.filter((_, i) => keys[i] === latest);
}

export function isIntradayInterval(interval: ChartInterval): boolean {
  return interval === "5m" || interval === "15m" || interval === "60m";
}

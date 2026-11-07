import type { IsoDate } from "@/lib/fortress/types";

export function addCalendarDays(iso: IsoDate, days: number): IsoDate {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function yearFraction(from: IsoDate, to: IsoDate): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return (b - a) / (365 * 24 * 60 * 60 * 1000);
}

export function dateOnOrBefore(left: IsoDate, right: IsoDate): boolean {
  return left <= right;
}

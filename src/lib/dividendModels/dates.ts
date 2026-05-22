/** Last calendar day of month for YYYY-MM (month is 1-12). */
export function monthEndIso(year: number, monthIndex0: number): string {
  const d = new Date(Date.UTC(year, monthIndex0 + 1, 0));
  return d.toISOString().slice(0, 10);
}

/** List month-end ISO dates from `startMonthEnd` through `endMonthEnd` inclusive. */
export function monthEndsBetweenInclusive(startMonthEnd: string, endMonthEnd: string): string[] {
  const out: string[] = [];
  if (startMonthEnd > endMonthEnd) return out;
  let y = Number(startMonthEnd.slice(0, 4));
  let m = Number(startMonthEnd.slice(5, 7)) - 1;
  const endY = Number(endMonthEnd.slice(0, 4));
  const endM = Number(endMonthEnd.slice(5, 7)) - 1;
  while (y < endY || (y === endY && m <= endM)) {
    out.push(monthEndIso(y, m));
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }
  return out;
}

/** Month-end string for `d` in UTC. */
export function monthEndForDate(d: Date): string {
  return monthEndIso(d.getUTCFullYear(), d.getUTCMonth());
}

/**
 * Friday (UTC calendar) of the week containing `d`.
 * Used as stable `as_of` week key for forward_snap rows (final + partial).
 */
export function fridayOfUtcWeekContaining(d: Date): string {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = x.getUTCDay(); // 0 Sun .. 6 Sat
  const delta = (5 - dow + 7) % 7;
  x.setUTCDate(x.getUTCDate() + delta);
  return x.toISOString().slice(0, 10);
}

export function parseIsoDate(s: string): Date {
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(5, 7)) - 1;
  const d = Number(s.slice(8, 10));
  return new Date(Date.UTC(y, m, d, 12, 0, 0));
}

export function compareIso(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

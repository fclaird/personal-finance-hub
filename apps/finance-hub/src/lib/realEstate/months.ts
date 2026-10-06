/** YYYY-MM from an ISO date. */
export function monthOf(isoDate: string): string {
  return isoDate.slice(0, 7);
}

/** Last calendar day of YYYY-MM, as YYYY-MM-DD. */
export function endOfMonth(month: string): string {
  const year = Number(month.slice(0, 4));
  const monthIndex = Number(month.slice(5, 7));
  const last = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
  return `${month}-${String(last).padStart(2, "0")}`;
}

/** Inclusive month list from start through end (both YYYY-MM). */
export function monthRange(start: string, end: string): string[] {
  const out: string[] = [];
  let year = Number(start.slice(0, 4));
  let month = Number(start.slice(5, 7));
  const endYear = Number(end.slice(0, 4));
  const endMonth = Number(end.slice(5, 7));
  while (year < endYear || (year === endYear && month <= endMonth)) {
    out.push(`${year}-${String(month).padStart(2, "0")}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return out;
}

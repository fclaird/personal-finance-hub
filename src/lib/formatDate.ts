/** Calendar dates stored as YYYY-MM-DD (UTC noon) for display. */

const LOCALE = "en-US";
const TZ = "UTC";

const DISPLAY_DATE: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: TZ,
};

const DISPLAY_DATE_SHORT: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  timeZone: TZ,
};

const DISPLAY_MONTH: Intl.DateTimeFormatOptions = {
  month: "short",
  year: "numeric",
  timeZone: TZ,
};

/** Parse YYYY-MM-DD (or longer ISO prefix) as UTC noon. */
export function parseIsoDateUtc(iso: string | null | undefined): Date | null {
  const s = (iso ?? "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const t = new Date(`${s}T12:00:00Z`).getTime();
  return Number.isFinite(t) ? new Date(t) : null;
}

/** e.g. Feb 28, 2026 */
export function formatDisplayDate(
  iso: string | null | undefined,
  opts?: { short?: boolean; fallback?: string },
): string {
  const d = parseIsoDateUtc(iso);
  if (!d) return opts?.fallback ?? "—";
  return d.toLocaleDateString(LOCALE, opts?.short ? DISPLAY_DATE_SHORT : DISPLAY_DATE);
}

/** e.g. Feb 2026 from YYYY-MM or YYYY-MM-DD */
export function formatDisplayMonth(iso: string | null | undefined, fallback = "—"): string {
  const s = (iso ?? "").trim();
  const m = s.match(/^(\d{4})-(\d{2})/);
  if (!m) return fallback;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || mo < 1 || mo > 12) return fallback;
  const d = new Date(Date.UTC(y, mo - 1, 1, 12, 0, 0));
  return d.toLocaleDateString(LOCALE, DISPLAY_MONTH);
}

export function formatDisplayDateRange(
  startIso: string | null | undefined,
  endIso: string | null | undefined,
): string {
  const a = formatDisplayDate(startIso, { fallback: "" });
  const b = formatDisplayDate(endIso, { fallback: "" });
  if (!a && !b) return "—";
  if (a && b) return `${a} → ${b}`;
  return a || b;
}

/** Chart / tooltip period label for a month-end or week-end ISO date. */
export function formatPeriodEndingLabel(iso: string | null | undefined, liveWeekly: boolean): string {
  const d = formatDisplayDate(iso);
  if (d === "—") return d;
  return liveWeekly ? `Week ending ${d}` : `Month ending ${d}`;
}

/** X-axis tick labels for Sim Dividend Portfolio (sparse quarters on multi-year windows). */
export function formatModeledChartMonthEndLabel(
  monthEndIso: string,
  windowYears: 1 | 3 | 5,
  liveWeekly: boolean,
): string {
  const s = (monthEndIso ?? "").trim().slice(0, 10);
  if (liveWeekly) return formatDisplayDate(s, { short: true, fallback: s });

  const y = Number(s.slice(0, 4));
  const mo = Number(s.slice(5, 7));
  if (!Number.isFinite(y) || !Number.isFinite(mo)) return formatDisplayMonth(s, s);

  const m = mo - 1;
  if (windowYears === 1) {
    const dt = new Date(Date.UTC(y, m, 1, 12, 0, 0));
    return dt.toLocaleDateString(LOCALE, { month: "short", timeZone: TZ });
  }

  const quarterEnd = [2, 5, 8, 11];
  if (!quarterEnd.includes(m)) return "";
  const q = Math.floor(m / 3) + 1;
  return `Q${q} '${String(y).slice(-2)}`;
}

/** Timestamps (ISO datetime) for “Saved …”, report generated at, etc. */
export function formatDisplayDateTime(iso: string | null | undefined, fallback = "—"): string {
  const raw = (iso ?? "").trim();
  if (!raw) return fallback;
  const t = Date.parse(raw);
  if (!Number.isFinite(t)) return formatDisplayDate(raw, { fallback });
  return new Date(t).toLocaleString(LOCALE, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

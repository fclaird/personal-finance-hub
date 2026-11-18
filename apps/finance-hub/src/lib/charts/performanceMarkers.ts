/**
 * Permanent vertical markers for the Performance charts.
 *
 * Add another `{ date, label }` entry to draw another line. The charts key
 * their x-axis by a gapless sequence index; other charts use a date category
 * or an epoch timestamp. `referenceLineXForDate` maps a calendar day onto
 * whichever of those the axis actually uses.
 */

export type PerformanceChartMarker = {
  /** Calendar day the event happened, YYYY-MM-DD. */
  date: string;
  /** Short label drawn at the top of the line. */
  label: string;
};

/** Chris liquidated every BMNR position on Wednesday Nov 5, 2026 (final close 12:28 PM ET). */
export const PERFORMANCE_CHART_MARKERS: readonly PerformanceChartMarker[] = [
  {
    date: "2026-11-05",
    label: "BMNR exit · Nov 5",
  },
];

export type AxisKeyedPoint = {
  /**
   * Value the x-axis keys.
   * A YYYY-MM-DD category, an epoch timestamp (ms, or seconds when >= 1e9),
   * or any other axis value when `date` is set (the performance charts use a sequence index).
   */
  x: string | number;
  /** Calendar day for this point when `x` is not itself a date or a timestamp. */
  date?: string | null;
};

export type AxisPlacement = {
  x: string | number;
  /** Day the line sits on. The marker day on an exact hit, otherwise the snapped point. */
  axisDate: string;
};

export type PlacedPerformanceMarker = PerformanceChartMarker & AxisPlacement;

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})/;
/** Epoch milliseconds at 1973-03-03. Sequence indexes stay far below this. */
const EPOCH_MS_MIN = 1e11;
/** Epoch seconds at 2001-09-09. */
const EPOCH_SEC_MIN = 1e9;

/** YYYY-MM-DD prefix, or null when the text is not a real calendar day. */
export function normalizeIsoDay(value: string | null | undefined): string | null {
  const match = ISO_DAY.exec((value ?? "").trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function isoDayFromEpoch(value: number): string | null {
  if (!Number.isFinite(value)) return null;
  const ms = value >= EPOCH_MS_MIN ? value : value >= EPOCH_SEC_MIN ? value * 1000 : null;
  if (ms == null) return null;
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function calendarDay(point: AxisKeyedPoint): string | null {
  const explicit = normalizeIsoDay(point.date);
  if (explicit) return explicit;
  if (typeof point.x === "string") return normalizeIsoDay(point.x);
  if (typeof point.x === "number") return isoDayFromEpoch(point.x);
  return null;
}

/**
 * X value for a Recharts ReferenceLine, or null when the day is outside the
 * points' span (the line should not render).
 *
 * An exact calendar-day hit uses that point. When the axis skips the day
 * (weekend, holiday, or a missing category) the line snaps to the first
 * point on or after it, still inside the span. String categories and epoch
 * timestamps are read from `x`; a sequence index needs `date`.
 */
export function referenceLineXForDate(
  markerDate: string,
  points: readonly AxisKeyedPoint[],
): AxisPlacement | null {
  const target = normalizeIsoDay(markerDate);
  if (!target) return null;

  const keyed = points.flatMap((point) => {
    const day = calendarDay(point);
    return day ? [{ day, x: point.x }] : [];
  });
  if (keyed.length === 0) return null;

  keyed.sort((a, b) => {
    if (a.day !== b.day) return a.day < b.day ? -1 : 1;
    if (typeof a.x === "number" && typeof b.x === "number") return a.x - b.x;
    return 0;
  });

  const first = keyed[0]!.day;
  const last = keyed[keyed.length - 1]!.day;
  if (target < first || target > last) return null;

  const snap = keyed.find((row) => row.day >= target);
  if (!snap) return null;
  return { x: snap.x, axisDate: snap.day };
}

/** Markers whose day falls inside `points`, each with the x value the axis expects. */
export function placePerformanceMarkers(
  markers: readonly PerformanceChartMarker[],
  points: readonly AxisKeyedPoint[],
): PlacedPerformanceMarker[] {
  const placed: PlacedPerformanceMarker[] = [];
  for (const marker of markers) {
    const hit = referenceLineXForDate(marker.date, points);
    if (!hit) continue;
    placed.push({ date: marker.date, label: marker.label, x: hit.x, axisDate: hit.axisDate });
  }
  return placed;
}

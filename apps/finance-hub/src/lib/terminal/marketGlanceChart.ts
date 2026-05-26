import type { UsMarketGlanceItem } from "@/app/components/terminal/MarketGlanceCard";

export type GlanceChartLine = {
  id: string;
  label: string;
  color: string;
};

export const GLANCE_CHART_LINES: GlanceChartLine[] = [
  { id: "portfolio", label: "Portfolio", color: "#2563eb" },
  { id: "sp500", label: "S&P 500", color: "#16a34a" },
  { id: "nasdaq", label: "Nasdaq", color: "#0891b2" },
];

export const GLANCE_ALTERNATE_CHART_LINES: GlanceChartLine[] = [
  { id: "russell2000", label: "Russell 2000", color: "#ea580c" },
  { id: "gold", label: "Gold", color: "#ca8a04" },
  { id: "bitcoin", label: "Bitcoin", color: "#f59e0b" },
  { id: "us-cl", label: "WTI Crude", color: "#ea580c" },
  { id: "jp-n225", label: "Nikkei 225", color: "#2563eb" },
  { id: "ftse100", label: "FTSE 100", color: "#0891b2" },
];

export const FUTURES_GLANCE_CHART_LINES: GlanceChartLine[] = [
  { id: "jp-n225", label: "Nikkei 225", color: "#2563eb" },
  { id: "us-es", label: "S&P 500 E-mini", color: "#16a34a" },
  { id: "us-nq", label: "Nasdaq 100 E-mini", color: "#0891b2" },
  { id: "russell2000", label: "Russell 2000", color: "#ea580c" },
];

const NY_TZ = "America/New_York";

export type IndexedGlancePoint = { idx: number; value: number; tsMs?: number };

export type GlanceCombinedChartRow = {
  idx: number;
  tsMs: number | null;
} & Record<string, number | null>;

export function resolveGlanceChartLines(items: UsMarketGlanceItem[]): GlanceChartLine[] {
  const ids = new Set(items.map((i) => i.id));
  const known = [...GLANCE_CHART_LINES, ...GLANCE_ALTERNATE_CHART_LINES, ...FUTURES_GLANCE_CHART_LINES].filter(
    (l) => ids.has(l.id),
  );
  if (known.length > 0) return known;
  const palette = ["#16a34a", "#0891b2", "#2563eb", "#ea580c", "#dc2626"];
  return items.map((item, i) => ({
    id: item.id,
    label: item.label,
    color: palette[i % palette.length]!,
  }));
}

/** Full intraday path including extended-hours segment when present. */
export function fullGlanceSeries(item: UsMarketGlanceItem): Array<{ idx: number; close: number; tsMs?: number }> {
  const regular = item.series;
  const extended = item.extendedSeries ?? [];
  if (extended.length === 0) return regular;
  if (regular.length === 0) return extended;
  if (extended[0]!.idx === regular[regular.length - 1]!.idx) {
    return [...regular, ...extended.slice(1)];
  }
  return [...regular, ...extended];
}

/** Index intraday path to 100 at prior close so series are comparable on one chart. */
export function indexedGlanceSeries(item: UsMarketGlanceItem): IndexedGlancePoint[] {
  const base = item.previousClose;
  const source = fullGlanceSeries(item);
  if (base == null || !Number.isFinite(base) || base === 0) {
    return source.map((p) => ({ idx: p.idx, value: p.close, tsMs: p.tsMs }));
  }
  if (item.id === "portfolio") {
    return source.map((p) => ({ idx: p.idx, value: p.close, tsMs: p.tsMs }));
  }
  return source.map((p) => ({ idx: p.idx, value: (p.close / base) * 100, tsMs: p.tsMs }));
}

/** Convert indexed glance value (100 = flat) to rebased % change for overlay charts. */
export function indexedGlanceValueToRebasedPct(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return value - 100;
}

export function formatGlanceCombinedChartTime(tsMs: number): string {
  const d = new Date(tsMs);
  const date = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: NY_TZ,
  }).format(d);
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: NY_TZ,
  }).format(d);
  return `${date} · ${time} ET`;
}

function sampleIndexedValue(points: Array<{ value: number }>, position: number): number | null {
  if (points.length === 0) return null;
  if (points.length === 1) return points[0]!.value;
  const pos = Math.max(0, Math.min(position, points.length - 1));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return points[lo]!.value;
  const frac = pos - lo;
  return points[lo]!.value * (1 - frac) + points[hi]!.value * frac;
}

function sampleIndexedValueAtTime(points: IndexedGlancePoint[], tsMs: number): number | null {
  const timed = points.filter((p) => p.tsMs != null && Number.isFinite(p.tsMs));
  if (timed.length === 0) return null;
  const first = timed[0]!;
  const last = timed[timed.length - 1]!;
  const firstTs = first.tsMs!;
  const lastTs = last.tsMs!;
  if (tsMs <= firstTs) return first.value;
  if (tsMs >= lastTs) return last.value;
  for (let i = 1; i < timed.length; i++) {
    const hi = timed[i]!;
    const lo = timed[i - 1]!;
    const hiTs = hi.tsMs!;
    const loTs = lo.tsMs!;
    if (tsMs <= hiTs) {
      if (hiTs === loTs) return hi.value;
      const frac = (tsMs - loTs) / (hiTs - loTs);
      return lo.value * (1 - frac) + hi.value * frac;
    }
  }
  return last.value;
}

function mergeGlanceSeriesByIndex(
  indexed: Array<{ id: string; points: IndexedGlancePoint[] }>,
): GlanceCombinedChartRow[] {
  const maxLen = Math.max(...indexed.map((s) => s.points.length), 0);
  if (maxLen === 0) return [];

  const out: GlanceCombinedChartRow[] = [];
  for (let i = 0; i < maxLen; i++) {
    const row: GlanceCombinedChartRow = { idx: i, tsMs: null };
    const t = maxLen <= 1 ? 0 : i / (maxLen - 1);
    for (const { id, points } of indexed) {
      const position = t * Math.max(points.length - 1, 0);
      row[id] = sampleIndexedValue(points, position);
      if (row.tsMs == null) {
        const lo = Math.floor(position);
        const hi = Math.ceil(position);
        const tsLo = points[lo]?.tsMs;
        const tsHi = points[hi]?.tsMs;
        if (tsLo != null && tsHi != null && Number.isFinite(tsLo) && Number.isFinite(tsHi)) {
          row.tsMs = lo === hi ? tsLo : tsLo + (tsHi - tsLo) * (position - lo);
        } else if (tsLo != null) {
          row.tsMs = tsLo;
        }
      }
    }
    out.push(row);
  }
  return out;
}

function mergeGlanceSeriesByTimestamp(
  indexed: Array<{ id: string; points: IndexedGlancePoint[] }>,
): GlanceCombinedChartRow[] {
  const tsSet = new Set<number>();
  for (const { points } of indexed) {
    for (const p of points) {
      if (p.tsMs != null && Number.isFinite(p.tsMs)) tsSet.add(p.tsMs);
    }
  }
  const timestamps = [...tsSet].sort((a, b) => a - b);
  if (timestamps.length < 2) return [];

  return timestamps.map((tsMs, idx) => {
    const row: GlanceCombinedChartRow = { idx, tsMs };
    for (const { id, points } of indexed) {
      row[id] = sampleIndexedValueAtTime(points, tsMs);
    }
    return row;
  });
}

/** Resample all glance series to a shared x-axis for a multi-line chart. */
export function mergeGlanceSeriesForChart(items: UsMarketGlanceItem[]): GlanceCombinedChartRow[] {
  const indexed = items.map((item) => ({
    id: item.id,
    points: indexedGlanceSeries(item),
  }));
  const byTime = mergeGlanceSeriesByTimestamp(indexed);
  if (byTime.length >= 2) return byTime;
  return mergeGlanceSeriesByIndex(indexed);
}

export function glanceChartYDomain(
  data: Array<Record<string, number | null>>,
  lineIds: string[],
): [number, number] {
  const vals: number[] = [100];
  for (const row of data) {
    for (const id of lineIds) {
      const v = row[id];
      if (v != null && Number.isFinite(v)) vals.push(v);
    }
  }
  if (vals.length === 0) return [99, 101];
  let min = Math.min(...vals);
  let max = Math.max(...vals);
  if (min === max) {
    const bump = 0.15;
    min -= bump;
    max += bump;
  } else {
    const pad = Math.max((max - min) * 0.05, 0.02);
    min -= pad;
    max += pad;
  }
  return [min, max];
}

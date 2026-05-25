import type { UsMarketGlanceItem } from "@/app/components/terminal/MarketGlanceCard";

export type GlanceChartLine = {
  id: string;
  label: string;
  color: string;
};

export const GLANCE_CHART_LINES: GlanceChartLine[] = [
  { id: "portfolio", label: "Portfolio", color: "#2563eb" },
  { id: "sp500", label: "S&P 500", color: "#16a34a" },
  { id: "nasdaq", label: "Nasdaq", color: "#9333ea" },
  { id: "russell2000", label: "Russell 2000", color: "#ea580c" },
];

/** Index intraday path to 100 at prior close so series are comparable on one chart. */
export function indexedGlanceSeries(item: UsMarketGlanceItem): Array<{ idx: number; value: number }> {
  const base = item.previousClose;
  if (base == null || !Number.isFinite(base) || base === 0) {
    return item.series.map((p) => ({ idx: p.idx, value: p.close }));
  }
  if (item.id === "portfolio") {
    return item.series.map((p) => ({ idx: p.idx, value: p.close }));
  }
  return item.series.map((p) => ({ idx: p.idx, value: (p.close / base) * 100 }));
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

/** Resample all glance series to a shared x-axis for a multi-line chart. */
export function mergeGlanceSeriesForChart(
  items: UsMarketGlanceItem[],
): Array<{ idx: number } & Record<string, number | null>> {
  const indexed = items.map((item) => ({
    id: item.id,
    points: indexedGlanceSeries(item),
  }));
  const maxLen = Math.max(...indexed.map((s) => s.points.length), 0);
  if (maxLen === 0) return [];

  const out: Array<{ idx: number } & Record<string, number | null>> = [];
  for (let i = 0; i < maxLen; i++) {
    const row: { idx: number } & Record<string, number | null> = { idx: i };
    const t = maxLen <= 1 ? 0 : i / (maxLen - 1);
    for (const { id, points } of indexed) {
      const position = t * Math.max(points.length - 1, 0);
      row[id] = sampleIndexedValue(points, position);
    }
    out.push(row);
  }
  return out;
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
    const pad = Math.max((max - min) * 0.12, 0.08);
    min -= pad;
    max += pad;
  }
  return [min, max];
}

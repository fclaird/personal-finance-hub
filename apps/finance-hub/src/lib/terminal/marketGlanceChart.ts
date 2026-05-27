import type { UsMarketGlanceItem } from "@/app/components/terminal/MarketGlanceCard";
import { GLANCE_CHART_BASELINE, yDomainFromChartRange } from "@/app/components/terminal/MarketGlanceCard";
import {
  glanceItemForTileChart,
  type GlanceTileChartWindowCtx,
} from "@/lib/market/glanceTileChartWindow";
import { nyWallTimeMs } from "@/lib/market/futuresGlanceSession";

export type GlanceChartLine = {
  id: string;
  label: string;
  color: string;
};

export const GLANCE_CHART_LINES: GlanceChartLine[] = [
  { id: "portfolio", label: "Portfolio", color: "#2563eb" },
  { id: "nasdaq", label: "Nasdaq", color: "#0891b2" },
  { id: "sp500", label: "S&P 500", color: "#16a34a" },
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
export function mergeGlanceSeriesForChart(
  items: UsMarketGlanceItem[],
  windowCtx?: GlanceTileChartWindowCtx,
): GlanceCombinedChartRow[] {
  const source = windowCtx
    ? items.map((item) => glanceItemForTileChart(item, windowCtx).item)
    : items;
  const indexed = source.map((item) => ({
    id: item.id,
    points: indexedGlanceSeries(item),
  }));
  const byTime = mergeGlanceSeriesByTimestamp(indexed);
  if (byTime.length >= 2) return byTime;
  return mergeGlanceSeriesByIndex(indexed);
}

/** First merged row at or after the extended-hours window (RTH close or trim anchor). */
export function extendedOverlayStartIdx(
  rows: GlanceCombinedChartRow[],
  windowCtx: GlanceTileChartWindowCtx,
): number {
  if (rows.length === 0) return 0;
  const sessionYmd = windowCtx.sessionYmd ?? "";
  if (!sessionYmd) return rows.length - 1;

  const boundaryMs = windowCtx.marketOpen
    ? nyWallTimeMs(sessionYmd, 9 * 60 + 30)
    : nyWallTimeMs(sessionYmd, 16 * 60);

  for (let i = 0; i < rows.length; i++) {
    const ts = rows[i]!.tsMs;
    if (ts != null && Number.isFinite(ts) && ts >= boundaryMs) return i;
  }
  return Math.max(0, rows.length - 1);
}

export function priorCloseReferenceEndIdx(
  rows: GlanceCombinedChartRow[],
  windowCtx: GlanceTileChartWindowCtx,
): number {
  if (windowCtx.marketOpen) return rows.length - 1;
  const start = extendedOverlayStartIdx(rows, windowCtx);
  return Math.max(0, start);
}

/** 16:00 ET session-close x-position for overlay charts when the US market is closed. */
export function overlaySessionCloseBoundaryMs(windowCtx: GlanceTileChartWindowCtx): number | null {
  if (windowCtx.marketOpen || !windowCtx.sessionYmd) return null;
  return nyWallTimeMs(windowCtx.sessionYmd, 16 * 60);
}

/** Start gray overlay halfway between the last RTH tick and the 4:00 PM bell. */
export function overlayExtendedShadeStartX(
  rows: GlanceCombinedChartRow[],
  windowCtx: GlanceTileChartWindowCtx,
): number | null {
  const boundaryMs = overlaySessionCloseBoundaryMs(windowCtx);
  if (boundaryMs == null || rows.length < 2) return boundaryMs;

  const splitIdx = extendedOverlayStartIdx(rows, windowCtx);
  const lastRthIdx = Math.max(0, splitIdx - 1);
  const lastTs = rows[lastRthIdx]?.tsMs;
  if (lastTs != null && Number.isFinite(lastTs) && lastTs < boundaryMs) {
    return (lastTs + boundaryMs) / 2;
  }
  return boundaryMs;
}

/** Insert a synthetic row at the 4:00 PM ET bell so price/fill lines do not gap before after-hours ticks. */
export function insertOverlaySessionCloseBridge(
  rows: GlanceCombinedChartRow[],
  windowCtx: GlanceTileChartWindowCtx,
): GlanceCombinedChartRow[] {
  const boundaryMs = overlaySessionCloseBoundaryMs(windowCtx);
  if (boundaryMs == null || rows.length < 2) return rows;

  const splitIdx = extendedOverlayStartIdx(rows, windowCtx);
  const lastRthIdx = splitIdx > 0 ? splitIdx - 1 : -1;
  if (lastRthIdx < 0) return rows;

  const lastRth = rows[lastRthIdx]!;
  const lastTs = lastRth.tsMs;
  if (lastTs == null || !Number.isFinite(lastTs) || lastTs >= boundaryMs) return rows;

  const firstExtTs = rows[splitIdx]?.tsMs;
  if (firstExtTs != null && Number.isFinite(firstExtTs) && firstExtTs <= boundaryMs) return rows;

  const bridge: GlanceCombinedChartRow = { idx: 0, tsMs: boundaryMs };
  for (const [key, value] of Object.entries(lastRth)) {
    if (key === "idx" || key === "tsMs") continue;
    bridge[key] = value;
  }

  const out = [...rows.slice(0, splitIdx), bridge, ...rows.slice(splitIdx)];
  return out.map((row, idx) => ({ ...row, idx }));
}

export function sessionCloseReferenceY(item: UsMarketGlanceItem): number | null {
  const prev = item.previousClose;
  const close = item.sessionClose;
  if (prev == null || prev <= 0 || close == null || !Number.isFinite(close)) return null;
  return (close / prev) * GLANCE_CHART_BASELINE;
}

/** Gray extended-hours band on merged overlay charts (pre-market during RTH, after-hours when closed). */
export function extendedOverlayShadeRange(
  rows: GlanceCombinedChartRow[],
  windowCtx: GlanceTileChartWindowCtx,
  items?: UsMarketGlanceItem[],
): { fromIdx: number; toIdx: number } | null {
  const sessionYmd = windowCtx.sessionYmd ?? "";
  if (!sessionYmd || rows.length < 2) return null;
  const hasTimestamps = rows.some((row) => row.tsMs != null && Number.isFinite(row.tsMs));
  if (!hasTimestamps) return null;

  if (!windowCtx.marketOpen) {
    const fromIdx = extendedOverlayStartIdx(rows, windowCtx);
    const toIdx = rows.length - 1;
    if (fromIdx >= toIdx) return null;
    return { fromIdx, toIdx };
  }

  const openMs = nyWallTimeMs(sessionYmd, 9 * 60 + 30);
  const firstTs = rows[0]?.tsMs;
  if (firstTs == null || !Number.isFinite(firstTs) || firstTs >= openMs) {
    return null;
  }

  let toIdx = 0;
  for (let i = 0; i < rows.length; i++) {
    const ts = rows[i]!.tsMs;
    if (ts != null && Number.isFinite(ts) && ts >= openMs) {
      toIdx = Math.max(0, i - 1);
      return toIdx > 0 ? { fromIdx: 0, toIdx } : null;
    }
    toIdx = i;
  }
  return toIdx > 0 ? { fromIdx: 0, toIdx } : null;
}

export type OverlayPrimaryBandRow = GlanceCombinedChartRow & {
  gainFill?: number | null;
  lossFill?: number | null;
  extGainFill?: number | null;
  extLossFill?: number | null;
  gainStroke?: number | null;
  lossStroke?: number | null;
  extGainStroke?: number | null;
  extLossStroke?: number | null;
};

function overlayPriceStrokeFromFill(
  fill: number | null | undefined,
  referenceY: number,
): number | null {
  if (fill == null || !Number.isFinite(fill)) return null;
  if (Math.abs(fill - referenceY) <= 1e-9) return null;
  return fill;
}

function assignOverlayBandStrokes(
  row: OverlayPrimaryBandRow,
  priorRefY: number,
  sessionRefY: number | null,
): OverlayPrimaryBandRow {
  const rthCross =
    row.gainFill != null &&
    row.lossFill != null &&
    Math.abs(row.gainFill - priorRefY) <= 1e-9 &&
    Math.abs(row.lossFill - priorRefY) <= 1e-9;
  const extCross =
    sessionRefY != null &&
    row.extGainFill != null &&
    row.extLossFill != null &&
    Math.abs(row.extGainFill - sessionRefY) <= 1e-9 &&
    Math.abs(row.extLossFill - sessionRefY) <= 1e-9;

  return {
    ...row,
    gainStroke: rthCross ? priorRefY : overlayPriceStrokeFromFill(row.gainFill, priorRefY),
    lossStroke: rthCross ? priorRefY : overlayPriceStrokeFromFill(row.lossFill, priorRefY),
    extGainStroke: extCross ? sessionRefY : row.extGainFill ?? null,
    extLossStroke: extCross ? sessionRefY : row.extLossFill ?? null,
  };
}

/** Green/red fill keys for the primary overlay line vs prior close, then session close after the bell. */
export function enrichOverlayPrimaryLineBands(
  rows: GlanceCombinedChartRow[],
  primaryId: string,
  windowCtx: GlanceTileChartWindowCtx,
  primaryItem: UsMarketGlanceItem | undefined,
): OverlayPrimaryBandRow[] {
  const bridged = insertOverlaySessionCloseBridge(rows, windowCtx);
  const splitIdx = extendedOverlayStartIdx(bridged, windowCtx);
  const priorRefY = GLANCE_CHART_BASELINE;
  const sessionRefY =
    !windowCtx.marketOpen && primaryItem ? sessionCloseReferenceY(primaryItem) : null;

  const out: OverlayPrimaryBandRow[] = [];
  let lastRth: number | null = null;
  let lastExt: number | null = null;

  for (let i = 0; i < bridged.length; i++) {
    const row = bridged[i]!;
    const price = row[primaryId];
    const useSessionRef = !windowCtx.marketOpen && i >= splitIdx && sessionRefY != null;
    const refY = useSessionRef ? sessionRefY! : priorRefY;

    if (price != null && Number.isFinite(price)) {
      if (
        !useSessionRef &&
        lastRth != null &&
        (lastRth >= priorRefY) !== (price >= priorRefY)
      ) {
        out.push(
          assignOverlayBandStrokes(
            {
              ...row,
              gainFill: priorRefY,
              lossFill: priorRefY,
              extGainFill: null,
              extLossFill: null,
            },
            priorRefY,
            sessionRefY,
          ),
        );
      }
      if (
        useSessionRef &&
        lastExt != null &&
        (lastExt >= refY) !== (price >= refY)
      ) {
        out.push(
          assignOverlayBandStrokes(
            {
              ...row,
              gainFill: null,
              lossFill: null,
              extGainFill: refY,
              extLossFill: refY,
            },
            priorRefY,
            sessionRefY,
          ),
        );
      } else if (
        useSessionRef &&
        lastExt == null &&
        sessionRefY != null &&
        lastRth != null &&
        (lastRth >= sessionRefY) !== (price >= sessionRefY)
      ) {
        out.push(
          assignOverlayBandStrokes(
            {
              ...row,
              gainFill: null,
              lossFill: null,
              extGainFill: sessionRefY,
              extLossFill: sessionRefY,
            },
            priorRefY,
            sessionRefY,
          ),
        );
      }
    }

    const next: OverlayPrimaryBandRow = { ...row };
    if (price == null || !Number.isFinite(price)) {
      next.gainFill = null;
      next.lossFill = null;
      next.extGainFill = null;
      next.extLossFill = null;
    } else if (!useSessionRef) {
      const above = price >= priorRefY;
      next.gainFill = above ? price : null;
      next.lossFill = above ? null : price;
      next.extGainFill = null;
      next.extLossFill = null;
      if (!windowCtx.marketOpen && sessionRefY != null && i === splitIdx - 1 && splitIdx > 0) {
        const aboveExt = price >= sessionRefY;
        next.extGainFill = aboveExt ? price : null;
        next.extLossFill = aboveExt ? null : price;
      }
      lastRth = price;
    } else {
      const aboveExt = price >= refY;
      next.extGainFill = aboveExt ? price : null;
      next.extLossFill = aboveExt ? null : price;
      const abovePrior = price >= priorRefY;
      if (i === splitIdx) {
        next.gainFill = abovePrior ? price : null;
        next.lossFill = abovePrior ? null : price;
      } else {
        next.gainFill = null;
        next.lossFill = null;
      }
      lastExt = price;
    }
    out.push(assignOverlayBandStrokes(next, priorRefY, sessionRefY));
  }

  return out;
}

export function glanceChartYDomain(
  data: Array<Record<string, number | null>>,
  lineIds: string[],
  items?: UsMarketGlanceItem[],
  windowCtx?: GlanceTileChartWindowCtx,
): [number, number] {
  const vals: number[] = [];
  for (const row of data) {
    for (const id of lineIds) {
      const v = row[id];
      if (v != null && Number.isFinite(v)) vals.push(v);
    }
  }
  if (vals.length === 0) return [GLANCE_CHART_BASELINE - 0.03, GLANCE_CHART_BASELINE + 0.03];

  const refs: number[] = [GLANCE_CHART_BASELINE];
  if (items && windowCtx && !windowCtx.marketOpen) {
    for (const item of items) {
      const prev = item.previousClose;
      const close = item.sessionClose;
      if (prev != null && prev > 0 && close != null && Number.isFinite(close)) {
        refs.push((close / prev) * GLANCE_CHART_BASELINE);
      }
    }
  }

  return yDomainFromChartRange(Math.min(...vals), Math.max(...vals), refs);
}

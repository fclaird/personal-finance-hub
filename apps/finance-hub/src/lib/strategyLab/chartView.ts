/** Session-only price and P&L window for the Strategy Lab chart. Not stored. */

export type ChartView = {
  readonly xMin: number;
  readonly xMax: number;
  readonly yMin: number;
  readonly yMax: number;
};

export type ChartPoint = { readonly x: number; readonly y: number };

const MIN_SPAN_RATIO = 0.01;

export function sameView(a: ChartView | null, b: ChartView | null): boolean {
  if (a == null || b == null) return a === b;
  return a.xMin === b.xMin && a.xMax === b.xMax && a.yMin === b.yMin && a.yMax === b.yMax;
}

/** Keep the window inside the data and at least 1% of that span on each axis. */
export function clampView(view: ChartView, limits: ChartView): ChartView {
  const x = clampAxis(view.xMin, view.xMax, limits.xMin, limits.xMax);
  const y = clampAxis(view.yMin, view.yMax, limits.yMin, limits.yMax);
  return { xMin: x.min, xMax: x.max, yMin: y.min, yMax: y.max };
}

function clampAxis(min: number, max: number, limitMin: number, limitMax: number): { min: number; max: number } {
  const limitSpan = Math.max(limitMax - limitMin, 1e-9);
  const minSpan = Math.max(limitSpan * MIN_SPAN_RATIO, 1e-6);
  let lo = Number.isFinite(min) ? min : limitMin;
  let hi = Number.isFinite(max) ? max : limitMax;
  if (!(hi > lo)) {
    const mid = (lo + hi) / 2;
    lo = mid - minSpan / 2;
    hi = mid + minSpan / 2;
  }
  if (hi - lo < minSpan) {
    const mid = (lo + hi) / 2;
    lo = mid - minSpan / 2;
    hi = mid + minSpan / 2;
  }
  if (hi - lo >= limitSpan) return { min: limitMin, max: limitMax };
  if (lo < limitMin) {
    hi += limitMin - lo;
    lo = limitMin;
  }
  if (hi > limitMax) {
    lo -= hi - limitMax;
    hi = limitMax;
  }
  return { min: Math.max(lo, limitMin), max: Math.min(hi, limitMax) };
}

/**
 * Zoom by `factor` around a data point. Factor above 1 zooms in (the window shrinks)
 * and the cursor keeps its place in the window until the edges hit the data.
 */
export function zoomAroundCursor(view: ChartView, cursor: ChartPoint, factor: number, limits: ChartView): ChartView {
  const safe = Number.isFinite(factor) && factor > 0 ? Math.min(8, Math.max(0.125, factor)) : 1;
  const xSpan = view.xMax - view.xMin;
  const ySpan = view.yMax - view.yMin;
  const nextX = xSpan / safe;
  const nextY = ySpan / safe;
  const rx = xSpan === 0 ? 0.5 : (cursor.x - view.xMin) / xSpan;
  const ry = ySpan === 0 ? 0.5 : (cursor.y - view.yMin) / ySpan;
  const xMin = cursor.x - rx * nextX;
  const yMin = cursor.y - ry * nextY;
  return clampView({ xMin, xMax: xMin + nextX, yMin, yMax: yMin + nextY }, limits);
}

/** Slide the window by data units. Positive x moves the data left (the view follows the drag). */
export function panView(view: ChartView, dx: number, dy: number, limits: ChartView): ChartView {
  return clampView(
    {
      xMin: view.xMin + dx,
      xMax: view.xMax + dx,
      yMin: view.yMin + dy,
      yMax: view.yMax + dy,
    },
    limits,
  );
}

/** Back to the fitted window. */
export function resetView(home: ChartView, limits: ChartView): ChartView {
  return clampView(home, limits);
}

/** Replace the window, used by Fit all crossovers and the typed spot range. */
export function fitView(xMin: number, xMax: number, yMin: number, yMax: number, limits: ChartView): ChartView {
  return clampView({ xMin, xMax, yMin, yMax }, limits);
}

/** Drag-rectangle zoom. A zero-area box is ignored. */
export function boxZoomView(a: ChartPoint, b: ChartPoint, limits: ChartView): ChartView | null {
  const xMin = Math.min(a.x, b.x);
  const xMax = Math.max(a.x, b.x);
  const yMin = Math.min(a.y, b.y);
  const yMax = Math.max(a.y, b.y);
  if (!(xMax > xMin) || !(yMax > yMin)) return null;
  return clampView({ xMin, xMax, yMin, yMax }, limits);
}

/** P&L extent of samples whose price is inside the window, with a little padding. */
export function ySpanForX(samples: readonly ChartPoint[], xMin: number, xMax: number): { min: number; max: number } | null {
  let min = Infinity;
  let max = -Infinity;
  for (const sample of samples) {
    if (sample.x < xMin || sample.x > xMax || !Number.isFinite(sample.y)) continue;
    if (sample.y < min) min = sample.y;
    if (sample.y > max) max = sample.y;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  const pad = Math.max((max - min) * 0.06, 1);
  return { min: min - pad, max: max + pad };
}

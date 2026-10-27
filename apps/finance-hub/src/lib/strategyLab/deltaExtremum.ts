import { formatInt } from "@/lib/format";

/** Interior peak or trough of an effective-delta curve. Price is where the slope is zero. */
export type DeltaExtremum = {
  readonly price: number;
  readonly delta: number;
  readonly kind: "peak" | "trough";
};

export type DeltaSample = {
  readonly price: number;
  readonly delta: number;
};

const VALUE_EPS = 1e-3;

/**
 * Vertical step between marker labels.
 * A bold 13px label with a 3px dark halo measures about 23px tall, so the step
 * leaves a gap when neighboring prices share the same horizontal span.
 */
export const OPTIMAL_LANE_PX = 28;

/** Chart label: price and the effective delta at that price. */
export function effectiveOptimalLabel(price: number, delta: number): string {
  return `Effective optimal price $${price.toFixed(2)} · Δ ${formatInt(delta)}`;
}

/** Readout cell beside the optimal-price column. Same price and delta as the marker. */
export function effectiveOptimalReadout(price: number, delta: number): string {
  return `$${price.toFixed(2)} · Δ ${formatInt(delta)}`;
}

/** Approximate width of a bold 13px label, used to keep neighbors off the same row. */
export function optimalLabelWidthPx(text: string): number {
  return Math.ceil(text.length * 7.6) + 14;
}

/**
 * Puts each marker on a row that does not cross another label or the spot tag.
 * A label near the right edge hangs to the left of its line.
 */
export function assignOptimalLanes<T extends { price: number; label: string }>(
  markers: readonly T[],
  spotPrice: number,
  xMin: number,
  xMax: number,
  widthPx: number,
): (T & { lane: number; anchorEnd: boolean })[] {
  const span = Math.max(xMax - xMin, 1);
  const width = Math.max(widthPx, 1);
  const toPx = (price: number) => ((price - xMin) / span) * width;
  const band = (price: number, labelPx: number, anchorEnd: boolean): [number, number] => {
    const x = toPx(price);
    return anchorEnd ? [x - labelPx - 8, x + 4] : [x - 4, x + labelPx + 8];
  };
  const hits = (lane: number, range: [number, number], occupied: { lane: number; range: [number, number] }[]) =>
    occupied.some((other) => other.lane === lane && other.range[0] < range[1] && range[0] < other.range[1]);

  const occupied: { lane: number; range: [number, number] }[] = [{ lane: 0, range: band(spotPrice, 48, false) }];
  const placed: (T & { lane: number; anchorEnd: boolean })[] = [];
  for (const marker of markers) {
    if (marker.price < xMin || marker.price > xMax) continue;
    const anchorEnd = marker.price > xMin + span * 0.68;
    const range = band(marker.price, optimalLabelWidthPx(marker.label), anchorEnd);
    let lane = 0;
    while (hits(lane, range, occupied)) lane += 1;
    occupied.push({ lane, range });
    placed.push({ ...marker, lane, anchorEnd });
  }
  return placed;
}

/**
 * Price where the sampled delta curve turns: slope goes from rising to falling, or the reverse.
 * The turn is located on the sample grid, then refined with a golden-section search when an
 * evaluator is supplied, or a parabola through the neighboring samples when it is not.
 * A flat top or bottom uses the center of that run. A monotone curve, a flat line, and a
 * turn that touches either end of the sample return null.
 */
export function deltaExtremum(
  samples: readonly DeltaSample[],
  evaluate?: (price: number) => number | null,
): DeltaExtremum | null {
  const points = uniquePrices(samples);
  if (points.length < 3) return null;

  const candidates = turns(points).filter((turn) => turn.prominence > VALUE_EPS);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.prominence - a.prominence || (a.kind === b.kind ? 0 : a.kind === "peak" ? -1 : 1));
  const best = candidates[0]!;
  const refined = refine(points, best, evaluate);
  if (refined == null || !Number.isFinite(refined.price) || !Number.isFinite(refined.delta)) return null;
  return { price: refined.price, delta: refined.delta, kind: best.kind };
}

type Turn = {
  readonly kind: "peak" | "trough";
  readonly from: number;
  readonly to: number;
  readonly prominence: number;
  readonly gridDelta: number;
};

function uniquePrices(samples: readonly DeltaSample[]): DeltaSample[] {
  const sorted = samples
    .filter((sample) => Number.isFinite(sample.price) && Number.isFinite(sample.delta))
    .slice()
    .sort((a, b) => a.price - b.price);
  const points: DeltaSample[] = [];
  for (const sample of sorted) {
    const last = points[points.length - 1];
    if (last && Math.abs(last.price - sample.price) < 1e-9) points[points.length - 1] = sample;
    else points.push(sample);
  }
  return points;
}

function direction(dy: number): -1 | 0 | 1 {
  if (dy > VALUE_EPS) return 1;
  if (dy < -VALUE_EPS) return -1;
  return 0;
}

function turns(points: readonly DeltaSample[]): Turn[] {
  const dirs: Array<-1 | 0 | 1> = [];
  for (let i = 0; i < points.length - 1; i++) dirs.push(direction(points[i + 1]!.delta - points[i]!.delta));

  const found: Turn[] = [];
  let upAt: number | null = null;
  let downAt: number | null = null;
  for (let i = 0; i < dirs.length; i++) {
    const dir = dirs[i];
    if (dir === 1) {
      if (downAt != null) {
        pushTurn(found, points, "trough", downAt, i);
        downAt = null;
      }
      upAt = i + 1;
    } else if (dir === -1) {
      if (upAt != null) {
        pushTurn(found, points, "peak", upAt, i);
        upAt = null;
      }
      downAt = i + 1;
    }
  }
  return found;
}

function pushTurn(found: Turn[], points: readonly DeltaSample[], kind: "peak" | "trough", from: number, to: number): void {
  if (from <= 0 || to >= points.length - 1 || to < from) return;
  const run = points.slice(from, to + 1);
  const gridDelta = kind === "peak" ? Math.max(...run.map((point) => point.delta)) : Math.min(...run.map((point) => point.delta));
  const left = points[from - 1]!.delta;
  const right = points[to + 1]!.delta;
  const prominence = kind === "peak" ? gridDelta - Math.max(left, right) : Math.min(left, right) - gridDelta;
  found.push({ kind, from, to, prominence, gridDelta });
}

function refine(
  points: readonly DeltaSample[],
  turn: Turn,
  evaluate?: (price: number) => number | null,
): { price: number; delta: number } | null {
  const run = points.slice(turn.from, turn.to + 1);
  const flat = run.length > 1 && Math.max(...run.map((point) => point.delta)) - Math.min(...run.map((point) => point.delta)) <= VALUE_EPS;
  if (flat) {
    const price = (run[0]!.price + run[run.length - 1]!.price) / 2;
    const delta = evaluate?.(price);
    return { price, delta: delta != null && Number.isFinite(delta) ? delta : turn.gridDelta };
  }

  const left = points[turn.from - 1]!.price;
  const right = points[turn.to + 1]!.price;
  if (evaluate && right - left > 0.01) {
    const searched = goldenSection(left, right, turn.kind, evaluate);
    if (searched != null) return searched;
  }

  const bestIndex = run.reduce((best, point, index) => {
    const better = turn.kind === "peak" ? point.delta > run[best]!.delta : point.delta < run[best]!.delta;
    return better ? index : best;
  }, 0);
  const center = turn.from + bestIndex;
  const fitted = parabolaVertex(points[center - 1]!, points[center]!, points[center + 1]!, turn.kind);
  const price = fitted ?? points[center]!.price;
  return { price, delta: points[center]!.delta };
}

/** Unimodal search. A flat bracket returns its center so a plateau is not pushed to one end. */
function goldenSection(
  left: number,
  right: number,
  kind: "peak" | "trough",
  evaluate: (price: number) => number | null,
): { price: number; delta: number } | null {
  const probe = [0, 0.25, 0.5, 0.75, 1].map((t) => evaluate(left + (right - left) * t));
  if (probe.some((value) => value == null || !Number.isFinite(value))) return null;
  const values = probe as number[];
  if (Math.max(...values) - Math.min(...values) <= VALUE_EPS) {
    const price = (left + right) / 2;
    const delta = evaluate(price);
    return delta == null ? null : { price, delta };
  }

  const phi = (Math.sqrt(5) - 1) / 2;
  let a = left;
  let b = right;
  let c = b - phi * (b - a);
  let d = a + phi * (b - a);
  let fc = evaluate(c);
  let fd = evaluate(d);
  if (fc == null || fd == null) return null;
  const better = (leftValue: number, rightValue: number) => (kind === "peak" ? leftValue > rightValue : leftValue < rightValue);
  for (let i = 0; i < 48 && b - a > Math.max(0.01, Math.abs(left) * 1e-5); i++) {
    if (better(fc, fd)) {
      b = d;
      d = c;
      fd = fc;
      c = b - phi * (b - a);
      const next = evaluate(c);
      if (next == null) return null;
      fc = next;
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + phi * (b - a);
      const next = evaluate(d);
      if (next == null) return null;
      fd = next;
    }
  }
  const price = (a + b) / 2;
  const delta = evaluate(price);
  return delta == null ? null : { price, delta };
}

function parabolaVertex(left: DeltaSample, mid: DeltaSample, right: DeltaSample, kind: "peak" | "trough"): number | null {
  const x0 = left.price;
  const x1 = mid.price;
  const x2 = right.price;
  const y0 = left.delta;
  const y1 = mid.delta;
  const y2 = right.delta;
  const denom = (x0 - x1) * (x0 - x2) * (x1 - x2);
  if (Math.abs(denom) < 1e-12) return null;
  const a = (x2 * (y1 - y0) + x1 * (y0 - y2) + x0 * (y2 - y1)) / denom;
  const b = (x2 * x2 * (y0 - y1) + x1 * x1 * (y2 - y0) + x0 * x0 * (y1 - y2)) / denom;
  if (Math.abs(a) < 1e-12) return null;
  if (kind === "peak" && a >= 0) return null;
  if (kind === "trough" && a <= 0) return null;
  const x = -b / (2 * a);
  const lo = Math.min(x0, x2);
  const hi = Math.max(x0, x2);
  if (x <= lo || x >= hi) return null;
  return x;
}

/**
 * Exact expiry zones from piecewise-linear payoffs.
 * P&L is whatever the caller passes (sized packages, idle cash not added).
 * A crossover is a spot where two series trade places. A zone boundary is a
 * spot where the leader changes, plus the all-lose cutoff and a capped winner's
 * max-gain plateau.
 */

const TIE = 0.005;

export type ZoneSeries = {
  readonly id: string;
  readonly label: string;
  readonly pnl: (spot: number) => number;
  /** Dollars of P&L per $1 of spot at and beyond the last knot. */
  readonly terminalSlope: number;
  readonly knots: readonly number[];
  /** First spot where this series is flat at its capped max gain. */
  readonly plateauFrom: number | null;
};

export type ExpiryCrossover = {
  readonly spot: number;
  readonly overtakesId: string;
  readonly overtakesLabel: string;
  readonly overtakenId: string;
  readonly overtakenLabel: string;
  readonly leadChange: boolean;
};

export type ExpiryZone = {
  readonly lo: number;
  readonly hi: number | null;
  readonly bestId: string;
  readonly bestLabel: string;
  readonly runnerUpId: string | null;
  readonly runnerUpLabel: string | null;
  readonly edge: number;
  readonly allLose: boolean;
  readonly plateau: boolean;
  readonly tied: boolean;
  readonly uncapped: boolean;
};

export type SolvedZones = {
  readonly crossovers: readonly ExpiryCrossover[];
  readonly zones: readonly ExpiryZone[];
};

type PairHit = {
  readonly spot: number;
  readonly overtakes: ZoneSeries;
  readonly overtaken: ZoneSeries;
};

function uniqSpots(spots: readonly number[]): number[] {
  const sorted = [...spots].filter((s) => Number.isFinite(s)).sort((a, b) => a - b);
  const out: number[] = [];
  for (const spot of sorted) {
    const prev = out[out.length - 1];
    if (prev == null || spot - prev > 1e-4) out.push(spot);
  }
  return out;
}

function sign(value: number): -1 | 0 | 1 {
  if (Math.abs(value) <= TIE) return 0;
  return value > 0 ? 1 : -1;
}

function knotsOf(series: readonly ZoneSeries[]): number[] {
  return uniqSpots(series.flatMap((item) => item.knots));
}

function pairHits(a: ZoneSeries, b: ZoneSeries, knots: readonly number[]): PairHit[] {
  const pts = uniqSpots([0, ...knots]);
  const hits: PairHit[] = [];
  const push = (spot: number, overtakes: ZoneSeries, overtaken: ZoneSeries) => {
    if (!(spot >= 0) || !Number.isFinite(spot)) return;
    hits.push({ spot, overtakes, overtaken });
  };
  for (let i = 0; i < pts.length - 1; i++) {
    const x0 = pts[i]!;
    const x1 = pts[i + 1]!;
    const d0 = a.pnl(x0) - b.pnl(x0);
    const d1 = a.pnl(x1) - b.pnl(x1);
    const s0 = sign(d0);
    const s1 = sign(d1);
    if (s0 === 0 && s1 === 0) continue;
    if (s0 === s1) continue;
    if (s0 === 0) {
      push(x0, s1 > 0 ? a : b, s1 > 0 ? b : a);
      continue;
    }
    if (s1 === 0) continue;
    const t = d0 / (d0 - d1);
    push(x0 + (x1 - x0) * t, s1 > 0 ? a : b, s1 > 0 ? b : a);
  }
  const last = pts[pts.length - 1] ?? 0;
  const dLast = a.pnl(last) - b.pnl(last);
  const slope = a.terminalSlope - b.terminalSlope;
  if (Math.abs(slope) <= 1e-9) return hits;
  if (sign(dLast) === 0) {
    push(last, slope > 0 ? a : b, slope > 0 ? b : a);
    return hits;
  }
  const spot = last - dLast / slope;
  if (spot > last + 1e-4) push(spot, slope > 0 ? a : b, slope > 0 ? b : a);
  return hits;
}

type Standing = {
  readonly ids: readonly string[];
  readonly best: ZoneSeries;
  readonly runner: ZoneSeries | null;
  readonly edge: number;
  readonly tied: boolean;
};

function standingAt(series: readonly ZoneSeries[], spot: number): Standing {
  const ranked = series
    .map((item) => ({ item, pnl: item.pnl(spot) }))
    .sort((a, b) => b.pnl - a.pnl || a.item.label.localeCompare(b.item.label) || a.item.id.localeCompare(b.item.id));
  const top = ranked[0]!;
  const second = ranked[1] ?? null;
  const ids = ranked
    .filter((row) => Math.abs(row.pnl - top.pnl) <= TIE)
    .map((row) => row.item.id)
    .sort();
  const tied = ids.length > 1;
  const rawEdge = second ? top.pnl - second.pnl : 0;
  const runner = tied ? (ranked.find((row) => row.item.id !== top.item.id)?.item ?? null) : (second?.item ?? null);
  return { ids, best: top.item, runner, edge: Math.abs(rawEdge) <= TIE ? 0 : rawEdge, tied };
}

function sameStanding(a: Standing, b: Standing): boolean {
  return a.ids.length === b.ids.length && a.ids.every((id, index) => id === b.ids[index]);
}

function firstUpCross(series: ZoneSeries, knots: readonly number[]): number | null {
  const pts = uniqSpots([0, ...knots, ...series.knots]);
  for (let i = 0; i < pts.length - 1; i++) {
    const x0 = pts[i]!;
    const x1 = pts[i + 1]!;
    const y0 = series.pnl(x0);
    const y1 = series.pnl(x1);
    if (y0 < -TIE && y1 >= -TIE) {
      if (Math.abs(y1 - y0) < 1e-12) return x1;
      return x0 + (x1 - x0) * ((0 - y0) / (y1 - y0));
    }
  }
  const last = pts[pts.length - 1] ?? 0;
  const y = series.pnl(last);
  if (y < -TIE && series.terminalSlope > 1e-9) return last - y / series.terminalSlope;
  return null;
}

function probe(lo: number, hi: number | null): number {
  if (hi == null) return lo + 1;
  return (lo + hi) / 2;
}

function zoneFrom(series: readonly ZoneSeries[], lo: number, hi: number | null, knots: readonly number[]): ExpiryZone {
  const at = standingAt(series, probe(lo, hi));
  const sample = probe(lo, hi);
  const bestPnl = at.best.pnl(sample);
  const allLose = series.every((item) => item.pnl(sample) < -TIE);
  const plateau =
    at.best.plateauFrom != null && sample >= at.best.plateauFrom - 1e-6 && bestPnl > TIE && !at.tied;
  const uncapped = at.best.terminalSlope > 1e-6 && (hi == null || (at.best.plateauFrom == null && sample >= (knots[knots.length - 1] ?? 0)));
  return {
    lo,
    hi,
    bestId: at.best.id,
    bestLabel: at.best.label,
    runnerUpId: at.runner?.id ?? null,
    runnerUpLabel: at.runner?.label ?? null,
    edge: at.edge,
    allLose,
    plateau,
    tied: at.tied,
    uncapped: uncapped && !at.tied,
  };
}

export function solveExpiryZones(series: readonly ZoneSeries[]): SolvedZones {
  if (series.length === 0) return { crossovers: [], zones: [] };
  const knots = knotsOf(series);
  const pairList: PairHit[] = [];
  for (let i = 0; i < series.length; i++) {
    for (let j = i + 1; j < series.length; j++) pairList.push(...pairHits(series[i]!, series[j]!, knots));
  }
  const spots = uniqSpots(pairList.map((hit) => hit.spot));
  const leadChanges: number[] = [];
  for (const spot of spots) {
    const left = standingAt(series, Math.max(0, spot - 1e-3));
    const right = standingAt(series, spot + 1e-3);
    if (!sameStanding(left, right)) leadChanges.push(spot);
  }
  const crossovers: ExpiryCrossover[] = [];
  for (const spot of spots) {
    const hits = pairList.filter((hit) => Math.abs(hit.spot - spot) <= 1e-4);
    const seen = new Set<string>();
    for (const hit of hits) {
      const key = `${hit.overtakes.id}>${hit.overtaken.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      crossovers.push({
        spot,
        overtakesId: hit.overtakes.id,
        overtakesLabel: hit.overtakes.label,
        overtakenId: hit.overtaken.id,
        overtakenLabel: hit.overtaken.label,
        leadChange: leadChanges.some((item) => Math.abs(item - spot) <= 1e-4),
      });
    }
  }
  const bounds = uniqSpots([0, ...leadChanges]);
  const pieces: { lo: number; hi: number | null }[] = [];
  for (let i = 0; i < bounds.length; i++) {
    pieces.push({ lo: bounds[i]!, hi: bounds[i + 1] ?? null });
  }
  const cuts = new Set<number>(bounds);
  const loseAt = series
    .map((item) => firstUpCross(item, knots))
    .filter((spot): spot is number => spot != null && spot > 0);
  if (loseAt.length && series.some((item) => item.pnl(0) < -TIE)) {
    const end = Math.min(...loseAt);
    const before = end > 1e-3 ? standingAt(series, end / 2) : null;
    const stillLosing = before ? series.every((item) => item.pnl(end / 2) < -TIE) : series.every((item) => item.pnl(0) < -TIE);
    if (stillLosing && series.some((item) => item.pnl(end + 1e-3) >= -TIE)) cuts.add(end);
  }
  for (const piece of pieces) {
    const winner = standingAt(series, probe(piece.lo, piece.hi)).best;
    const plateau = winner.plateauFrom;
    if (plateau != null && plateau > piece.lo + 1e-4 && (piece.hi == null || plateau < piece.hi - 1e-4)) {
      if (winner.pnl(plateau) > TIE) cuts.add(plateau);
    }
  }
  const edges = uniqSpots([...cuts]);
  const zones: ExpiryZone[] = [];
  for (let i = 0; i < edges.length; i++) {
    const lo = edges[i]!;
    const hi = edges[i + 1] ?? null;
    if (hi != null && hi - lo <= 1e-4) continue;
    zones.push(zoneFrom(series, lo, hi, knots));
  }
  return { crossovers, zones };
}

export function zoneContaining(zones: readonly ExpiryZone[], spot: number): ExpiryZone | null {
  for (const zone of zones) {
    if (spot + 1e-9 >= zone.lo && (zone.hi == null || spot < zone.hi - 1e-9)) return zone;
  }
  return zones[zones.length - 1] ?? null;
}

function price(n: number): string {
  return `$${n.toFixed(2)}`;
}

export function zoneOutcome(zone: ExpiryZone): string {
  if (zone.tied) {
    const other = zone.runnerUpLabel ?? "the other";
    if (zone.allLose) return `all lose, ${zone.bestLabel} and ${other} tie`;
    return `${zone.bestLabel} and ${other} tie`;
  }
  if (zone.allLose) return `all lose, ${zone.bestLabel} loses least`;
  if (zone.hi == null && zone.uncapped) return `${zone.bestLabel} wins and has no cap`;
  if (zone.plateau) return `${zone.bestLabel} wins, at its max gain`;
  return `${zone.bestLabel} wins`;
}

export function describeZone(zone: ExpiryZone): string {
  const where =
    zone.hi == null ? `Above ${price(zone.lo)}` : zone.lo <= 1e-6 ? `Below ${price(zone.hi)}` : `${price(zone.lo)} to ${price(zone.hi)}`;
  return `${where}: ${zoneOutcome(zone)}`;
}

export function describeSpotCallout(zone: ExpiryZone, spot: number): string {
  return `If spot ends at ${price(spot)}: ${zoneOutcome(zone)}`;
}

export function crossoverText(crossover: ExpiryCrossover): string {
  return `${crossover.overtakesLabel} passes ${crossover.overtakenLabel} at ${price(crossover.spot)}`;
}

function mergeRanges(zones: readonly ExpiryZone[]): { lo: number; hi: number | null }[] {
  const sorted = [...zones].sort((a, b) => a.lo - b.lo);
  const out: { lo: number; hi: number | null }[] = [];
  for (const zone of sorted) {
    const prev = out[out.length - 1];
    if (prev && prev.hi != null && Math.abs(prev.hi - zone.lo) <= 1e-3) {
      prev.hi = zone.hi;
      continue;
    }
    out.push({ lo: zone.lo, hi: zone.hi });
  }
  return out;
}

export function bestWhenLine(zones: readonly ExpiryZone[], id: string): string {
  const wins = zones.filter((zone) => zone.bestId === id && !zone.allLose && !zone.tied);
  if (wins.length === 0) return "never best";
  const parts = mergeRanges(wins).map((range) => {
    if (range.hi == null) return range.lo <= 1e-6 ? "at every price" : `above ${price(range.lo)}`;
    if (range.lo <= 1e-6) return `below ${price(range.hi)}`;
    return `between ${price(range.lo)} and ${price(range.hi)}`;
  });
  if (parts.length === 1 && parts[0] === "at every price") return "Best when spot ends at any price";
  return `Best when spot ends ${parts.join(", and ")}`;
}

export type SampledSeries = {
  readonly id: string;
  readonly label: string;
  readonly points: readonly { readonly spot: number; readonly pnl: number }[];
};

/** Linear interpolation of sampled curves. These spots are model estimates, not expiry algebra. */
export function solveSampledCrossovers(series: readonly SampledSeries[]): ExpiryCrossover[] {
  if (series.length < 2) return [];
  const base = series[0]!.points;
  const hits: { spot: number; overtakes: SampledSeries; overtaken: SampledSeries }[] = [];
  for (let i = 0; i < series.length; i++) {
    for (let j = i + 1; j < series.length; j++) {
      const a = series[i]!;
      const b = series[j]!;
      const n = Math.min(a.points.length, b.points.length, base.length);
      for (let k = 0; k < n - 1; k++) {
        const d0 = a.points[k]!.pnl - b.points[k]!.pnl;
        const d1 = a.points[k + 1]!.pnl - b.points[k + 1]!.pnl;
        const s0 = sign(d0);
        const s1 = sign(d1);
        if (s0 === 0 || s1 === 0 || s0 === s1) continue;
        const t = d0 / (d0 - d1);
        const left = a.points[k]!.spot;
        const right = a.points[k + 1]!.spot;
        hits.push({ spot: left + (right - left) * t, overtakes: s1 > 0 ? a : b, overtaken: s1 > 0 ? b : a });
      }
    }
  }
  const spots = uniqSpots(hits.map((hit) => hit.spot));
  const out: ExpiryCrossover[] = [];
  for (const spot of spots) {
    const here = hits.filter((hit) => Math.abs(hit.spot - spot) <= 1e-3);
    const seen = new Set<string>();
    for (const hit of here) {
      const key = `${hit.overtakes.id}>${hit.overtaken.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        spot,
        overtakesId: hit.overtakes.id,
        overtakesLabel: hit.overtakes.label,
        overtakenId: hit.overtaken.id,
        overtakenLabel: hit.overtaken.label,
        leadChange: false,
      });
    }
  }
  return out;
}

export function basisMetric(basis: { kind: "perPackage" } | { kind: "equalCapital"; capital: number; units: "whole" | "fractional" }): string {
  if (basis.kind === "perPackage") return "P&L per package";
  const dollars = `$${Math.round(basis.capital).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
  const units = basis.units === "whole" ? "whole contracts, idle cash earns 0" : "fractional contracts, idle cash earns 0";
  return `P&L on ${dollars}, ${units}`;
}

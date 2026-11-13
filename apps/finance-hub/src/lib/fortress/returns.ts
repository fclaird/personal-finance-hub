import type { Verdict } from "@/lib/fortress/evaluate";
import { netAssetValue } from "@/lib/fortress/ledger";
import type { Snapshot } from "@/lib/fortress/types";
import { ADJUSTED_PROVIDER, ADJUSTED_VERSION, CORPORATE_ACTIONS, type AdjBar } from "@/lib/market/adjustedClose";

export const MIN_RETURN_SAMPLE = 60;
export const ROLLING_WINDOW = 63;
export const STALE_CALENDAR_DAYS = 10;

const TAIL_NOTE = "Deterministic path losses stay on the maintenance scorecard. This panel does not estimate expected shortfall or a tail probability.";
const PROXY_NOTE = "Option exposure uses the underlying's adjusted moves scaled by the option Greek delta. This is not the option's profit and loss.";

export type HoldingWeight = {
  readonly symbol: string;
  readonly weight: number | null;
  readonly proxy: boolean;
};

export type SeriesBundle = {
  readonly symbol: string;
  readonly bars: readonly AdjBar[] | null;
  readonly reason?: string;
};

export type PairCorrelation = {
  readonly a: string;
  readonly b: string;
  readonly correlation: number | null;
  readonly observations: number;
  readonly status: "computed" | "unknown";
  readonly reason: string | null;
};

export type RiskSide = {
  readonly status: "computed" | "unknown";
  readonly reason: string | null;
  readonly weights: readonly { readonly symbol: string; readonly weight: number; readonly proxy: boolean }[];
  readonly sigma: number | null;
  readonly contributions: readonly { readonly symbol: string; readonly contribution: number }[];
  readonly identity: boolean | null;
};

export type Concentration = {
  readonly status: "computed" | "unknown";
  readonly reason: string | null;
  readonly hhi: number | null;
  readonly nweight: number | null;
};

export type ReturnReport = {
  readonly provider: typeof ADJUSTED_PROVIDER;
  readonly version: typeof ADJUSTED_VERSION;
  readonly corporateActions: typeof CORPORATE_ACTIONS;
  readonly benchmark: string;
  readonly comparisonDates: readonly string[];
  readonly lostBaselineDates: number;
  readonly excluded: readonly { readonly symbol: string; readonly reason: string; readonly observations: number }[];
  readonly included: readonly string[];
  readonly full: CorrelationBlock;
  readonly rolling: CorrelationBlock;
  readonly benchmarkDown: CorrelationBlock;
  readonly covariance: { readonly symbols: readonly string[]; readonly matrix: readonly (readonly number[])[]; readonly psd: boolean } | null;
  readonly beforeRisk: RiskSide;
  readonly afterRisk: RiskSide;
  readonly beforeConcentration: Concentration;
  readonly afterConcentration: Concentration;
  readonly proxyNote: string | null;
  readonly tailNote: string;
  readonly gate: "blocked" | "breach" | "complete";
  readonly gateSummary: string;
};

type CorrelationBlock = {
  readonly status: "computed" | "unknown";
  readonly reason: string | null;
  readonly observations: number;
  readonly before: readonly PairCorrelation[];
  readonly after: readonly PairCorrelation[];
};

type ReturnMap = Map<string, number>;

export function calendarDaysBetween(earlier: string, later: string): number {
  const a = Date.parse(`${earlier}T00:00:00Z`);
  const b = Date.parse(`${later}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

export function returnsFromAdjCloses(bars: readonly AdjBar[]): { readonly ok: true; readonly returns: readonly { readonly date: string; readonly value: number }[] } | { readonly ok: false; readonly reason: "duplicate-date" | "nonpositive" | "too-short" } {
  const ordered = [...bars].sort((left, right) => left.date.localeCompare(right.date));
  const seen = new Set<string>();
  for (const bar of ordered) {
    if (seen.has(bar.date)) return { ok: false, reason: "duplicate-date" };
    seen.add(bar.date);
    if (!(bar.adjClose > 0)) return { ok: false, reason: "nonpositive" };
  }
  if (ordered.length < 2) return { ok: false, reason: "too-short" };
  const returns: { date: string; value: number }[] = [];
  for (let i = 1; i < ordered.length; i++) {
    const previous = ordered[i - 1]!;
    const current = ordered[i]!;
    returns.push({ date: current.date, value: current.adjClose / previous.adjClose - 1 });
  }
  return { ok: true, returns };
}

export function pearson(left: readonly number[], right: readonly number[]): number | null {
  if (left.length !== right.length || left.length < 2) return null;
  const meanLeft = left.reduce((sum, value) => sum + value, 0) / left.length;
  const meanRight = right.reduce((sum, value) => sum + value, 0) / right.length;
  let numerator = 0;
  let leftSq = 0;
  let rightSq = 0;
  for (let i = 0; i < left.length; i++) {
    const a = left[i]! - meanLeft;
    const b = right[i]! - meanRight;
    numerator += a * b;
    leftSq += a * a;
    rightSq += b * b;
  }
  if (leftSq === 0 || rightSq === 0) return null;
  return numerator / Math.sqrt(leftSq * rightSq);
}

export function sampleCovariance(columns: readonly (readonly number[])[]): number[][] {
  const count = columns.length;
  const observations = columns[0]?.length ?? 0;
  const means = columns.map((column) => (observations === 0 ? 0 : column.reduce((sum, value) => sum + value, 0) / observations));
  const matrix = Array.from({ length: count }, () => Array<number>(count).fill(0));
  const denom = observations > 1 ? observations - 1 : 1;
  for (let i = 0; i < count; i++) {
    for (let j = i; j < count; j++) {
      let sum = 0;
      for (let t = 0; t < observations; t++) sum += (columns[i]![t]! - means[i]!) * (columns[j]![t]! - means[j]!);
      const value = sum / denom;
      matrix[i]![j] = value;
      matrix[j]![i] = value;
    }
  }
  return matrix;
}

/** Symmetric Jacobi. Eigenvalues below -tol fail. */
export function isPositiveSemidefinite(matrix: readonly (readonly number[])[], tol = 1e-8): boolean {
  const n = matrix.length;
  if (n === 0) return true;
  const a = matrix.map((row) => row.slice());
  for (let sweep = 0; sweep < 48; sweep++) {
    let max = 0;
    let p = 0;
    let q = 1;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const value = Math.abs(a[i]![j]!);
        if (value > max) {
          max = value;
          p = i;
          q = j;
        }
      }
    }
    if (max < 1e-12) break;
    const app = a[p]![p]!;
    const aqq = a[q]![q]!;
    const apq = a[p]![q]!;
    const tau = (aqq - app) / (2 * apq);
    const tangent = tau === 0 ? 1 : Math.sign(tau) / (Math.abs(tau) + Math.sqrt(1 + tau * tau));
    const cosine = 1 / Math.sqrt(1 + tangent * tangent);
    const sine = tangent * cosine;
    for (let k = 0; k < n; k++) {
      if (k === p || k === q) continue;
      const aik = a[k]![p]!;
      const akq = a[k]![q]!;
      a[k]![p] = a[p]![k] = cosine * aik - sine * akq;
      a[k]![q] = a[q]![k] = sine * aik + cosine * akq;
    }
    a[p]![p] = cosine * cosine * app - 2 * sine * cosine * apq + sine * sine * aqq;
    a[q]![q] = sine * sine * app + 2 * sine * cosine * apq + cosine * cosine * aqq;
    a[p]![q] = a[q]![p] = 0;
  }
  return a.every((row, index) => row[index]! >= -tol);
}

export function riskContributions(weights: readonly number[], covariance: readonly (readonly number[])[]): { readonly sigma: number | null; readonly contributions: number[] } {
  const count = weights.length;
  const marginal = Array<number>(count).fill(0);
  for (let i = 0; i < count; i++) {
    for (let j = 0; j < count; j++) marginal[i]! += covariance[i]![j]! * weights[j]!;
  }
  let variance = 0;
  for (let i = 0; i < count; i++) variance += weights[i]! * marginal[i]!;
  if (!(variance > 0)) return { sigma: null, contributions: [] };
  const sigma = Math.sqrt(variance);
  return { sigma, contributions: weights.map((weight, index) => (weight * marginal[index]!) / sigma) };
}

export function weightsFromSnapshot(snapshot: Snapshot, spots: Readonly<Record<string, number>> = {}): HoldingWeight[] {
  const nav = netAssetValue(snapshot);
  const rows = new Map<string, { dollars: number | null; proxy: boolean }>();
  const add = (symbol: string, dollars: number | null, proxy: boolean) => {
    const key = symbol.trim().toUpperCase();
    const current = rows.get(key);
    if (!current) {
      rows.set(key, { dollars, proxy });
      return;
    }
    current.proxy = current.proxy || proxy;
    current.dollars = current.dollars == null || dollars == null ? null : current.dollars + dollars;
  };
  for (const position of snapshot.positions) {
    if (position.kind === "option") {
      const spot = spots[position.contract.underlying];
      if (position.delta == null || !(spot > 0)) add(position.contract.underlying, null, true);
      else add(position.contract.underlying, position.quantity * position.contract.multiplier * position.delta * spot, true);
      continue;
    }
    add(position.symbol, position.quantity * position.mark, false);
  }
  const knownNav = nav.status === "known" && nav.value > 0;
  return [...rows].map(([symbol, row]) => ({
    symbol,
    weight: knownNav && row.dollars != null ? row.dollars / nav.value : null,
    proxy: row.proxy,
  }));
}

function intersection(maps: readonly ReturnMap[]): string[] {
  if (maps.length === 0) return [];
  const [first, ...rest] = maps;
  return [...first!.keys()].filter((date) => rest.every((map) => map.has(date))).sort();
}

function valuesOn(map: ReturnMap, dates: readonly string[]): number[] {
  return dates.map((date) => map.get(date)!);
}

function pairBlock(book: readonly string[], benchmark: string | null, maps: ReadonlyMap<string, ReturnMap>, dates: readonly string[]): PairCorrelation[] {
  const names = [...book];
  if (benchmark && !names.includes(benchmark)) names.push(benchmark);
  const pairs: PairCorrelation[] = [];
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = names[i]!;
      const b = names[j]!;
      const correlation = pearson(valuesOn(maps.get(a)!, dates), valuesOn(maps.get(b)!, dates));
      pairs.push({
        a,
        b,
        correlation,
        observations: dates.length,
        status: correlation == null ? "unknown" : "computed",
        reason: correlation == null ? "A series has zero variance on these dates." : null,
      });
    }
  }
  return pairs;
}

function emptyRisk(reason: string): RiskSide {
  return { status: "unknown", reason, weights: [], sigma: null, contributions: [], identity: null };
}

function concentrationOf(holdings: readonly HoldingWeight[]): Concentration {
  if (holdings.length === 0) return { status: "unknown", reason: "The book has no holdings.", hhi: null, nweight: null };
  if (holdings.some((holding) => holding.weight == null)) {
    return { status: "unknown", reason: "A signed weight is unknown, so concentration is unknown.", hhi: null, nweight: null };
  }
  const collapsed = new Map<string, number>();
  for (const holding of holdings) {
    collapsed.set(holding.symbol, (collapsed.get(holding.symbol) ?? 0) + holding.weight!);
  }
  const absolute = [...collapsed.values()].map((weight) => Math.abs(weight));
  const sum = absolute.reduce((total, value) => total + value, 0);
  if (!(sum > 0)) return { status: "unknown", reason: "Absolute weights sum to zero.", hhi: null, nweight: null };
  const hhi = absolute.reduce((total, value) => total + (value / sum) ** 2, 0);
  return { status: "computed", reason: null, hhi, nweight: hhi > 0 ? 1 / hhi : null };
}

function sideRisk(holdings: readonly HoldingWeight[], symbols: readonly string[], covariance: number[][] | null, excluded: ReadonlySet<string>): RiskSide {
  if (!covariance) return emptyRisk("The common panel is missing, so risk contribution is unknown.");
  const collapsed = new Map<string, { weight: number | null; proxy: boolean }>();
  for (const holding of holdings) {
    const current = collapsed.get(holding.symbol);
    if (!current) collapsed.set(holding.symbol, { weight: holding.weight, proxy: holding.proxy });
    else {
      current.proxy = current.proxy || holding.proxy;
      current.weight = current.weight == null || holding.weight == null ? null : current.weight + holding.weight;
    }
  }
  for (const symbol of collapsed.keys()) {
    if (excluded.has(symbol) || !symbols.includes(symbol)) {
      return emptyRisk(`${symbol} is outside the common panel, so this book's risk is unknown.`);
    }
  }
  const weights: number[] = [];
  for (const symbol of symbols) {
    const row = collapsed.get(symbol);
    if (row?.weight == null && row) return emptyRisk(`${symbol} has an unknown signed weight.`);
    weights.push(row?.weight ?? 0);
  }
  const { sigma, contributions } = riskContributions(weights, covariance);
  if (sigma == null) return emptyRisk("Portfolio variance is zero, so the risk contribution denominator is unknown.");
  const identityGap = Math.abs(contributions.reduce((sum, value) => sum + value, 0) - sigma);
  return {
    status: "computed",
    reason: null,
    weights: symbols.map((symbol, index) => ({ symbol, weight: weights[index]!, proxy: collapsed.get(symbol)?.proxy ?? false })),
    sigma,
    contributions: symbols.map((symbol, index) => ({ symbol, contribution: contributions[index]! })),
    identity: identityGap < 1e-6,
  };
}

export function buildReturnReport(input: {
  readonly asOf: string;
  readonly benchmark: string;
  readonly series: readonly SeriesBundle[];
  readonly before: readonly HoldingWeight[];
  readonly after: readonly HoldingWeight[];
  readonly maxAbsCorrelation?: number | null;
}): ReturnReport {
  const benchmark = input.benchmark.trim().toUpperCase();
  const bundles = new Map(input.series.map((series) => [series.symbol.trim().toUpperCase(), series]));
  const before = input.before.map((row) => ({ ...row, symbol: row.symbol.trim().toUpperCase() }));
  const after = input.after.map((row) => ({ ...row, symbol: row.symbol.trim().toUpperCase() }));
  const requested = [...new Set([...before.map((row) => row.symbol), ...after.map((row) => row.symbol), benchmark])];
  const excluded: { symbol: string; reason: string; observations: number }[] = [];
  const maps = new Map<string, ReturnMap>();

  for (const symbol of requested) {
    const bundle = bundles.get(symbol);
    if (!bundle || bundle.bars == null) {
      excluded.push({ symbol, reason: bundle?.reason ?? "no-adjclose", observations: 0 });
      continue;
    }
    const parsed = returnsFromAdjCloses(bundle.bars);
    if (!parsed.ok) {
      excluded.push({ symbol, reason: parsed.reason, observations: 0 });
      continue;
    }
    if (parsed.returns.length < MIN_RETURN_SAMPLE) {
      excluded.push({ symbol, reason: "short-history", observations: parsed.returns.length });
      continue;
    }
    const latest = bundle.bars.reduce((max, bar) => (bar.date > max ? bar.date : max), bundle.bars[0]!.date);
    if (calendarDaysBetween(latest, input.asOf) > STALE_CALENDAR_DAYS) {
      excluded.push({ symbol, reason: "stale", observations: parsed.returns.length });
      continue;
    }
    const values = parsed.returns.map((row) => row.value);
    if (pearson(values, values) == null) {
      excluded.push({ symbol, reason: "zero-variance", observations: parsed.returns.length });
      continue;
    }
    maps.set(symbol, new Map(parsed.returns.map((row) => [row.date, row.value])));
  }

  const excludedNames = new Set(excluded.map((row) => row.symbol));
  const beforeNames = [...new Set(before.map((row) => row.symbol))].filter((symbol) => maps.has(symbol));
  const afterNames = [...new Set(after.map((row) => row.symbol))].filter((symbol) => maps.has(symbol));
  const portfolioNames = [...new Set([...beforeNames, ...afterNames])];
  const panelNames = maps.has(benchmark) ? [...portfolioNames, benchmark] : portfolioNames;
  const comparisonDates = intersection(panelNames.map((symbol) => maps.get(symbol)!));
  const baselineNames = maps.has(benchmark) ? [...beforeNames, benchmark] : beforeNames;
  const baselineDates = intersection([...new Set(baselineNames)].map((symbol) => maps.get(symbol)!));
  const lostBaselineDates = baselineDates.filter((date) => !comparisonDates.includes(date)).length;
  const enough = comparisonDates.length >= MIN_RETURN_SAMPLE && portfolioNames.length > 0;
  const included = enough ? portfolioNames : [];

  const unknownBlock = (reason: string, observations: number): CorrelationBlock => ({
    status: "unknown",
    reason,
    observations,
    before: [],
    after: [],
  });

  let full: CorrelationBlock;
  let rolling: CorrelationBlock;
  let benchmarkDown: CorrelationBlock;
  let covariance: ReturnReport["covariance"] = null;
  const panelReason = !maps.has(benchmark)
    ? `${benchmark} has no adjusted series, so the common panel is unknown.`
    : portfolioNames.length === 0
      ? "No held name has a long enough adjusted series."
      : comparisonDates.length < MIN_RETURN_SAMPLE
        ? `The common dates have ${comparisonDates.length} returns. The minimum is ${MIN_RETURN_SAMPLE}.`
        : null;

  if (!enough || !maps.has(benchmark)) {
    full = unknownBlock(panelReason ?? "The common panel is unknown.", comparisonDates.length);
    rolling = unknownBlock(panelReason ?? "The rolling window is unknown.", Math.min(ROLLING_WINDOW, comparisonDates.length));
    benchmarkDown = unknownBlock(panelReason ?? "Benchmark-down dates are unknown.", 0);
  } else {
    const bench = benchmark;
    full = {
      status: "computed",
      reason: null,
      observations: comparisonDates.length,
      before: pairBlock(beforeNames, bench, maps, comparisonDates),
      after: pairBlock(afterNames, bench, maps, comparisonDates),
    };
    const rollingDates = comparisonDates.slice(-ROLLING_WINDOW);
    rolling = rollingDates.length >= MIN_RETURN_SAMPLE
      ? {
          status: "computed",
          reason: null,
          observations: rollingDates.length,
          before: pairBlock(beforeNames, bench, maps, rollingDates),
          after: pairBlock(afterNames, bench, maps, rollingDates),
        }
      : unknownBlock(`The rolling window has ${rollingDates.length} dates. The minimum is ${MIN_RETURN_SAMPLE}.`, rollingDates.length);
    const downDates = comparisonDates.filter((date) => (maps.get(bench)!.get(date) ?? 0) < 0);
    benchmarkDown = downDates.length >= MIN_RETURN_SAMPLE
      ? {
          status: "computed",
          reason: null,
          observations: downDates.length,
          before: pairBlock(beforeNames, bench, maps, downDates),
          after: pairBlock(afterNames, bench, maps, downDates),
        }
      : unknownBlock(`Benchmark-down dates number ${downDates.length}. The minimum is ${MIN_RETURN_SAMPLE}.`, downDates.length);
    const columns = included.map((symbol) => valuesOn(maps.get(symbol)!, comparisonDates));
    const matrix = sampleCovariance(columns);
    covariance = { symbols: included, matrix, psd: isPositiveSemidefinite(matrix) };
  }

  const beforeRisk = sideRisk(before, included, covariance?.matrix ? covariance.matrix.map((row) => row.slice()) : null, excludedNames);
  const afterRisk = sideRisk(after, included, covariance?.matrix ? covariance.matrix.map((row) => row.slice()) : null, excludedNames);
  const beforeConcentration = concentrationOf(before);
  const afterConcentration = concentrationOf(after);
  const proxy = before.some((row) => row.proxy) || after.some((row) => row.proxy);
  const heldExcluded = excluded.filter((row) => before.some((holding) => holding.symbol === row.symbol) || after.some((holding) => holding.symbol === row.symbol));
  const missing = heldExcluded.length > 0 || full.status !== "computed" || rolling.status !== "computed" || benchmarkDown.status !== "computed" || beforeRisk.status !== "computed" || afterRisk.status !== "computed" || beforeConcentration.status !== "computed" || afterConcentration.status !== "computed" || covariance?.psd !== true;
  let gate: ReturnReport["gate"] = missing ? "blocked" : "complete";
  let gateSummary = missing
    ? "Verdict blocked. Adjusted-return coverage is incomplete, so this is not a pass."
    : "Adjusted-return coverage is complete on the common dates. This is not a tail result and it is not an all-clear.";
  const limit = input.maxAbsCorrelation;
  if (!missing && limit != null && Number.isFinite(limit)) {
    const over = [...full.before, ...full.after].find((pair) => pair.correlation != null && Math.abs(pair.correlation) > limit);
    if (over) {
      gate = "breach";
      gateSummary = `${over.a}/${over.b} absolute correlation ${over.correlation!.toFixed(3)} is above ${limit} on the common dates.`;
    }
  }

  return {
    provider: ADJUSTED_PROVIDER,
    version: ADJUSTED_VERSION,
    corporateActions: CORPORATE_ACTIONS,
    benchmark,
    comparisonDates,
    lostBaselineDates,
    excluded,
    included,
    full,
    rolling,
    benchmarkDown,
    covariance,
    beforeRisk,
    afterRisk,
    beforeConcentration,
    afterConcentration,
    proxyNote: proxy ? PROXY_NOTE : null,
    tailNote: TAIL_NOTE,
    gate,
    gateSummary,
  };
}

/** A maintenance breach stays a breach. Missing adjusted history blocks a pass and does not invent one. */
export function displayedVerdict(engine: Verdict, report: ReturnReport | null): Verdict {
  if (engine.kind === "breach") return engine;
  if (!report || report.gate === "blocked") {
    return { kind: "blocked", summary: report?.gateSummary ?? "Verdict blocked. Adjusted-return history is not loaded, so this is not a pass." };
  }
  if (report.gate === "breach") return { kind: "breach", summary: report.gateSummary };
  return engine;
}

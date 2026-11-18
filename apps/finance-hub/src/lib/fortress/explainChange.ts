import type { ReturnReport } from "@/lib/fortress/returns";

/** Display band for daily sigma, in percentage points. Not a statistical test. */
export const SIGMA_POINT_BAND = 0.05;
const CORR_BAND = 0.01;
const N_BAND = 0.05;
const WEIGHT_BAND = 0.02;

export const SIGMA_DEFINITION =
  "Sigma is the historical variability of this book's daily adjusted returns on the shared sessions. The figure is daily, not annualized. The percentage is the size of a typical measured swing. The dollar figure multiplies that percentage by the book value. A lower measured variability is not a guarantee of safety, and it is not a cap on the worst loss.";

export const CORRELATION_DEFINITION =
  "Correlation is the historical tendency of two return series to move together, on a scale from -1 to +1. It is not the chance that they lose money on the same day. A correlation of 0 does not mean the series are independent. A lower correlation, by itself, does not mean the book's total variability is lower.";

export const CHANGE_DEFINITION =
  "The change column is the after number minus the before number. That difference is the only meaning of delta in this panel. The option Greek delta is a separate number: how much an option's price moves when the underlying moves. It is used only to size an option as a stand-in stock position, and only when that Greek is known.";

export type FundingContext = {
  readonly beforeNav: number | null;
  readonly afterNav: number | null;
  readonly externalCapitalChange: number;
  readonly debtChange: number;
};

export type SigmaMove = {
  readonly beforePercent: number;
  readonly afterPercent: number;
  readonly percentagePoints: number;
  readonly relativePercent: number | null;
  readonly direction: "increased" | "decreased" | "unchanged";
  readonly relativeSentence: string;
};

export type MeasuredRow = {
  readonly label: string;
  readonly before: string;
  readonly after: string;
  readonly change: string;
};

export type MeasuredChange = {
  readonly limited: boolean;
  readonly definitions: readonly string[];
  readonly lead: string;
  readonly sentences: readonly string[];
  readonly rows: readonly MeasuredRow[];
  readonly formulas: readonly string[];
  readonly sigmaDirection: "increased" | "decreased" | "unchanged" | "unknown";
};

const FORMULAS = [
  "Daily sigma is recomputed for each book as the square root of w′ Σ w. Σ is the sample covariance of daily simple adjusted returns on the shared dates, using n − 1. The before and after figures are those recomputed values. A linear first-order split of the change is not shown.",
  "Percentage points equal (after sigma − before sigma) × 100, with sigma in decimal form. The relative percent equals (after − before) / |before| × 100. The relative percent is undefined when the starting sigma is zero.",
  "Candidate-to-rest correlation uses the other names' signed book weights and the same covariance for both books. It is Cov(candidate, weighted rest) divided by the two standard deviations. Pairwise correlations are Pearson correlations on the shared dates and do not depend on position size.",
  "Risk contribution of a name is wᵢ times (Σ w)ᵢ, divided by sigma. The contributions sum to sigma, and a negative contribution is kept. Effective N is 1 divided by the sum of squared absolute-weight shares.",
];

export function describeSigmaMove(before: number, after: number): SigmaMove {
  const beforePercent = before * 100;
  const afterPercent = after * 100;
  const percentagePoints = afterPercent - beforePercent;
  const relativePercent = before === 0 ? null : ((after - before) / Math.abs(before)) * 100;
  const direction = Math.abs(percentagePoints) < SIGMA_POINT_BAND ? "unchanged" : percentagePoints > 0 ? "increased" : "decreased";
  const relativeSentence = relativePercent == null
    ? "The relative percent is undefined because the starting daily variability is zero."
    : `Relative to the starting daily variability, the change is ${signed(relativePercent, 1)}%. A relative percent and a percentage-point change are different. Neither one is a statistical-significance test.`;
  return { beforePercent, afterPercent, percentagePoints, relativePercent, direction, relativeSentence };
}

export function explainMeasuredChange(input: {
  readonly report: ReturnReport | null;
  readonly funding: FundingContext | null;
  readonly scopeLabel: string;
}): MeasuredChange {
  const definitions = [SIGMA_DEFINITION, CORRELATION_DEFINITION, CHANGE_DEFINITION];
  if (!input.report || input.report.beforeRisk.status !== "computed" || input.report.afterRisk.status !== "computed" || input.report.beforeRisk.sigma == null || input.report.afterRisk.sigma == null) {
    return {
      limited: true,
      definitions,
      lead: limitedLead(input.report, input.scopeLabel),
      sentences: limitedSentences(input.report),
      rows: [],
      formulas: FORMULAS,
      sigmaDirection: "unknown",
    };
  }

  const report = input.report;
  const beforeSigma = report.beforeRisk.sigma;
  const afterSigma = report.afterRisk.sigma;
  if (beforeSigma == null || afterSigma == null) {
    return { limited: true, definitions, lead: limitedLead(report, input.scopeLabel), sentences: limitedSentences(report), rows: [], formulas: FORMULAS, sigmaDirection: "unknown" };
  }
  const move = describeSigmaMove(beforeSigma, afterSigma);
  const first = report.comparisonDates[0];
  const last = report.comparisonDates[report.comparisonDates.length - 1];
  const period = first && last ? `${first} through ${last}` : "the shared sessions";
  const sentences: string[] = [];
  sentences.push(
    `These figures use ${report.comparisonDates.length} common sessions, ${period}. They are daily adjusted-close changes, not an annualized number. The minimum sample is 60 sessions. ${report.lostBaselineDates} baseline sessions were dropped so the before book and the after book use the same dates.`,
  );
  sentences.push(coverageSentence(report));
  sentences.push(move.relativeSentence);
  sentences.push(dollarSentence(beforeSigma, afterSigma, input.funding));
  sentences.push(fundingSentence(input.funding));
  sentences.push(bandSentence(move, input.funding));
  sentences.push(pairwiseSentence(report));
  sentences.push(...candidateSentences(report));
  sentences.push(downMarketSentence(report));
  sentences.push(concentrationSentence(report));
  sentences.push(...contributionSentences(report));
  if (report.proxyNote) {
    sentences.push("An option in this book is represented by the underlying's adjusted moves times the option Greek delta. That is a linear stand-in, not the option's profit and loss. Option margin is still unknown, so this description cannot complete a pass.");
  }
  sentences.push("The before and after variability figures are each recomputed from that book's weights. Changing the mix does not rewrite the historical pairwise correlations.");

  const rows: MeasuredRow[] = [
    {
      label: "Daily sigma",
      before: pct(move.beforePercent),
      after: pct(move.afterPercent),
      change: `${signed(move.percentagePoints, 2)} percentage points`,
    },
    {
      label: "Relative to starting sigma",
      before: pct(move.beforePercent),
      after: pct(move.afterPercent),
      change: move.relativePercent == null ? "undefined" : `${signed(move.relativePercent, 1)}%`,
    },
    dollarRow(beforeSigma, afterSigma, input.funding),
    {
      label: "Effective N",
      before: count(report.beforeConcentration.nweight),
      after: count(report.afterConcentration.nweight),
      change: diffCount(report.beforeConcentration.nweight, report.afterConcentration.nweight),
    },
    ...restRows(report),
  ];

  return {
    limited: false,
    definitions,
    lead: swingSentence(move),
    sentences,
    rows,
    formulas: FORMULAS,
    sigmaDirection: move.direction,
  };
}

function limitedLead(report: ReturnReport | null, scopeLabel: string): string {
  const prefix = scopeLabel.trim() ? `${scopeLabel.trim()} ` : "";
  if (!report) return `${prefix}Adjusted-return history is not loaded, so variability, correlation, and concentration cannot be compared. This is not treated as an improvement.`;
  const reasons = [
    ...report.excluded.map((row) => `${row.symbol} is ${row.reason} (${row.observations} observations)`),
    report.beforeRisk.reason,
    report.afterRisk.reason,
    report.full.reason,
  ].filter((reason): reason is string => Boolean(reason));
  const detail = reasons.length > 0 ? ` ${reasons[0]}.` : "";
  return `${prefix}The measured change in variability cannot be stated.${detail} Missing history, a short sample, a zero-variance series, or a zero denominator is left unknown. It is not described as an improvement.`;
}

function limitedSentences(report: ReturnReport | null): string[] {
  if (!report) return ["Load an adjusted-close series before reading a before and after comparison."];
  const sentences = ["No favorable reading is filled in for the unknown rows."];
  if (report.proxyNote) {
    sentences.push("An option would be only a linear stand-in for the underlying, using the option Greek delta when it is known. Option margin is still unknown, so this description cannot complete a pass.");
  }
  if (report.excluded.some((row) => row.reason === "short-history")) {
    sentences.push("A name with fewer than 60 adjusted returns stays out of the comparison. Its absence is not a low correlation.");
  }
  if (report.excluded.some((row) => row.reason === "zero-variance" || row.reason === "no-adjclose")) {
    sentences.push("A series with no adjusted close, or with no variation, has no correlation and no variability to compare.");
  }
  return sentences;
}

function swingSentence(move: SigmaMove): string {
  if (move.direction === "unchanged") {
    return `Measured daily swings are essentially unchanged, a difference of ${signed(move.percentagePoints, 2)} percentage points, from ${pct(move.beforePercent)} to ${pct(move.afterPercent)} a day. The band for that wording is ${SIGMA_POINT_BAND} percentage points. It is not a statistical-significance test.`;
  }
  const verb = move.direction === "increased" ? "increased" : "decreased";
  return `Measured daily swings ${verb} by ${signed(Math.abs(move.percentagePoints), 2)} percentage points, from ${pct(move.beforePercent)} to ${pct(move.afterPercent)} a day.`;
}

function dollarSentence(beforeSigma: number, afterSigma: number, funding: FundingContext | null): string {
  if (!funding || funding.beforeNav == null || funding.afterNav == null || !(funding.beforeNav > 0) || !(funding.afterNav > 0)) {
    return "Dollar variability is unknown because the book value is missing or not positive. The percentage above is not a dollar loss.";
  }
  const before = beforeSigma * funding.beforeNav;
  const after = afterSigma * funding.afterNav;
  const change = after - before;
  const unchanged = Math.abs(change) < 1 || (before > 0 && Math.abs(change) / before < 0.02);
  const move = unchanged ? "The dollar variability is essentially unchanged." : change > 0 ? "The dollar variability is higher." : "The dollar variability is lower.";
  return `On the before book value of ${money(funding.beforeNav)}, one daily standard deviation is about ${money(before)}. On the after book value of ${money(funding.afterNav)}, it is about ${money(after)}. ${move} That dollar number is the daily percentage times the book value. It is not a predicted loss, and it is not a worst-day cap.`;
}

function fundingSentence(funding: FundingContext | null): string {
  if (!funding) return "Funding was not attached to this comparison, so new cash and new debt are not separated from a change in mix.";
  const capital = Math.abs(funding.externalCapitalChange) >= 1;
  const debt = Math.abs(funding.debtChange) >= 1;
  if (capital && funding.externalCapitalChange > 0 && !debt) {
    return `New capital of ${money(funding.externalCapitalChange)} was added. Cash has no adjusted-return series here, so it dilutes the percentage variability without adding its own historical swings. The dollar figure still uses the new book value.`;
  }
  if (capital && funding.externalCapitalChange < 0 && !debt) {
    return `Capital of ${money(Math.abs(funding.externalCapitalChange))} left the book. The percentage and the dollar figure can move differently because the book value changed.`;
  }
  if (debt && !capital) {
    return `Debt changed by ${money(funding.debtChange)}. Borrowed cash raises assets and debt together. Dollar variability is applied to net book value, not to the borrowed amount by itself.`;
  }
  if (capital && debt) {
    return `Capital changed by ${money(funding.externalCapitalChange)} and debt changed by ${money(funding.debtChange)}. Those funding moves are separate from a pure replacement of one holding with another.`;
  }
  return "No new capital and no debt change were recorded. This comparison is a replacement inside the book, so a percentage move is about the mix.";
}

function bandSentence(move: SigmaMove, funding: FundingContext | null): string {
  const dollars = funding && funding.afterNav != null && funding.afterNav > 0 ? ` On the after book value that band is about ±${money((move.afterPercent / 100) * funding.afterNav)}.` : "";
  return `A one-sigma band on this sample is ±${pct(move.afterPercent)} a day.${dollars} Reading the band as a typical day assumes the swings stay this size and are roughly bell-shaped. This display does not assign a probability to any future day, and it does not annualize the daily figure.`;
}

function pairwiseSentence(report: ReturnReport): string {
  const before = new Map(report.full.before.map((pair) => [pairKey(pair.a, pair.b), pair.correlation]));
  const shared: string[] = [];
  let drifted = false;
  for (const pair of report.full.after) {
    const key = pairKey(pair.a, pair.b);
    if (!before.has(key)) continue;
    const left = before.get(key);
    if (left == null || pair.correlation == null) continue;
    shared.push(`${pair.a}/${pair.b}`);
    if (Math.abs(left - pair.correlation) > 1e-6) drifted = true;
  }
  if (report.full.status !== "computed") {
    return `Full-sample pairwise correlation is unknown. ${report.full.reason ?? "The shared dates are not enough."} It is not filled in as a low correlation.`;
  }
  if (drifted) {
    return "Some pairwise correlations differ between the columns. Both columns are still the historical series on the shared dates, not a new correlation created by the trade.";
  }
  if (shared.length === 0) {
    return "There is no shared pair to compare. A correlation that appears only after a name is added is still the historical correlation of the two series on the shared dates, not a result of the position size.";
  }
  return `Historical pairwise correlations did not change (${shared.join(", ")}). Both columns use the same ${report.full.observations} sessions. Changing the mix does not rewrite those correlations.`;
}

function candidateSentences(report: ReturnReport): string[] {
  const matrix = report.covariance?.matrix;
  const symbols = report.covariance?.symbols ?? [];
  if (!matrix) return ["Candidate-to-rest correlation is unknown because the covariance was not built."];
  const before = weightMap(report.beforeRisk);
  const after = weightMap(report.afterRisk);
  const names = [...new Set([...before.keys(), ...after.keys()])].filter((symbol) => {
    const left = before.get(symbol) ?? 0;
    const right = after.get(symbol) ?? 0;
    return Math.abs(right - left) >= WEIGHT_BAND;
  });
  if (names.length === 0) return ["No name's signed weight moved enough to single out. The comparison universe is unchanged."];
  const lines = [
    `The comparison universe is ${symbols.join(", ") || "the included names"}, with signed net-asset-value weights on one covariance. ${report.benchmark} is the benchmark and is not given a portfolio weight. Cash is outside that covariance. A name's correlation with the rest of the book can stay high when the position is small. Size and funding decide the effect.`,
  ];
  for (const symbol of names) {
    const beforeCorr = restCorrelation(symbol, report.beforeRisk, matrix);
    const afterCorr = restCorrelation(symbol, report.afterRisk, matrix);
    const weight = after.get(symbol) ?? before.get(symbol) ?? 0;
    const shown = afterCorr ?? beforeCorr;
    const small = Math.abs(weight) < 0.1 && shown != null && Math.abs(shown) >= 0.5
      ? ` Its weight is only ${weight.toFixed(2)}, so the correlation alone does not move the book.`
      : "";
    lines.push(`${symbol}'s correlation with the rest of the before book is ${corrText(beforeCorr)}, and with the rest of the after book is ${corrText(afterCorr)}.${small}`);
  }
  return lines;
}

function downMarketSentence(report: ReturnReport): string {
  if (report.benchmarkDown.status !== "computed") {
    return `Down-market correlation is unknown. ${report.benchmarkDown.reason ?? "The down-market sample is missing."} Unknown is not treated as a low correlation.`;
  }
  const pairs = report.benchmarkDown.after.filter((pair) => pair.status === "computed" && pair.correlation != null);
  if (pairs.length === 0) return `Down-market correlation has ${report.benchmarkDown.observations} sessions and no computed pair.`;
  const sample = pairs.slice(0, 3).map((pair) => `${pair.a}/${pair.b} ${pair.correlation!.toFixed(3)}`).join(", ");
  return `On the ${report.benchmarkDown.observations} sessions when ${report.benchmark}'s adjusted return was negative, pairwise correlations include ${sample}. A down-market correlation is still a tendency to move together, not the chance of a joint loss.`;
}

function concentrationSentence(report: ReturnReport): string {
  const before = report.beforeConcentration.nweight;
  const after = report.afterConcentration.nweight;
  if (report.beforeConcentration.status !== "computed" || report.afterConcentration.status !== "computed" || before == null || after == null) {
    return "Effective N is unknown, so this change is not described as more spread out or more concentrated.";
  }
  const diff = after - before;
  if (Math.abs(diff) < N_BAND) return `Effective N is essentially unchanged, from ${before.toFixed(2)} to ${after.toFixed(2)}. That wording is a display band of ${N_BAND}, not a statistical test.`;
  const verb = diff > 0 ? "spread out" : "became more concentrated";
  return `Exposures ${verb}. Effective N went from ${before.toFixed(2)} to ${after.toFixed(2)}. Effective N is 1 divided by the sum of squared absolute-weight shares. It is not a count of tickers.`;
}

function contributionSentences(report: ReturnReport): string[] {
  if (report.beforeRisk.identity === false || report.afterRisk.identity === false) {
    return ["The risk-contribution identity did not hold, so those rows are not described as a shift."];
  }
  const before = new Map(report.beforeRisk.contributions.map((row) => [row.symbol, row.contribution]));
  const after = new Map(report.afterRisk.contributions.map((row) => [row.symbol, row.contribution]));
  const lines: string[] = [];
  for (const symbol of [...new Set([...before.keys(), ...after.keys()])]) {
    const left = before.get(symbol);
    const right = after.get(symbol);
    if (left == null || right == null) continue;
    const delta = right - left;
    if (Math.abs(delta) < 0.0005) continue;
    const sign = right < 0 || left < 0 ? " A negative contribution means that weight reduced the book's measured daily variability on this sample." : "";
    lines.push(`${symbol}'s contribution to daily variability changed from ${left.toFixed(4)} to ${right.toFixed(4)}, a signed change of ${signed(delta, 4)}.${sign}`);
  }
  if (lines.length === 0) return ["No name's contribution to daily variability moved enough to describe."];
  return lines;
}

function restRows(report: ReturnReport): MeasuredRow[] {
  const matrix = report.covariance?.matrix;
  if (!matrix) return [];
  const before = weightMap(report.beforeRisk);
  const after = weightMap(report.afterRisk);
  const names = [...new Set([...before.keys(), ...after.keys()])].filter((symbol) => Math.abs((after.get(symbol) ?? 0) - (before.get(symbol) ?? 0)) >= WEIGHT_BAND);
  return names.map((symbol) => {
    const left = restCorrelation(symbol, report.beforeRisk, matrix);
    const right = restCorrelation(symbol, report.afterRisk, matrix);
    const change = left == null || right == null ? "unknown" : signed(right - left, 3);
    return {
      label: `${symbol} correlation with the rest of the book`,
      before: corrText(left),
      after: corrText(right),
      change,
    };
  });
}

function restCorrelation(symbol: string, risk: ReturnReport["beforeRisk"], matrix: readonly (readonly number[])[]): number | null {
  const weights = risk.weights;
  const index = weights.findIndex((row) => row.symbol === symbol);
  if (index < 0 || weights.length !== matrix.length) return null;
  const rest = weights.map((row, i) => (i === index ? 0 : row.weight));
  if (rest.every((value) => value === 0)) return null;
  const variance = matrix[index]?.[index] ?? 0;
  let restVariance = 0;
  let cross = 0;
  for (let i = 0; i < rest.length; i++) {
    cross += (matrix[index]?.[i] ?? 0) * rest[i]!;
    for (let j = 0; j < rest.length; j++) restVariance += rest[i]! * (matrix[i]?.[j] ?? 0) * rest[j]!;
  }
  if (!(variance > 0) || !(restVariance > 0)) return null;
  const correlation = cross / Math.sqrt(variance * restVariance);
  if (!Number.isFinite(correlation) || correlation < -1.0001 || correlation > 1.0001) return null;
  return correlation;
}

function dollarRow(beforeSigma: number, afterSigma: number, funding: FundingContext | null): MeasuredRow {
  if (!funding || funding.beforeNav == null || funding.afterNav == null || !(funding.beforeNav > 0) || !(funding.afterNav > 0)) {
    return { label: "One daily sigma in dollars", before: "unknown", after: "unknown", change: "unknown" };
  }
  const before = beforeSigma * funding.beforeNav;
  const after = afterSigma * funding.afterNav;
  return { label: "One daily sigma in dollars", before: money(before), after: money(after), change: money(after - before) };
}

function weightMap(risk: ReturnReport["beforeRisk"]): Map<string, number> {
  return new Map(risk.weights.map((row) => [row.symbol, row.weight]));
}

function coverageSentence(report: ReturnReport): string {
  if (report.excluded.length === 0) return "No held name was excluded from the shared dates.";
  return `Excluded: ${report.excluded.map((row) => `${row.symbol} (${row.reason}, ${row.observations})`).join("; ")}.`;
}

function pairKey(a: string, b: string): string {
  return [a, b].sort().join("|");
}

function pct(value: number): string {
  return `${value.toFixed(2)}%`;
}

function count(value: number | null): string {
  return value == null ? "unknown" : value.toFixed(2);
}

function diffCount(before: number | null, after: number | null): string {
  if (before == null || after == null) return "unknown";
  return signed(after - before, 2);
}

function corrText(value: number | null): string {
  if (value == null) return "unknown";
  if (Math.abs(value) < CORR_BAND) return `${value.toFixed(3)} (near zero, which is not independence)`;
  return value.toFixed(3);
}

function signed(value: number, digits: number): string {
  const text = value.toFixed(digits);
  return value > 0 ? `+${text}` : text;
}

function money(value: number): string {
  const rounded = Math.round(value);
  const body = Math.abs(rounded).toLocaleString("en-US");
  return rounded < 0 ? `−$${body}` : `$${body}`;
}

import { bsmGreeks, normCdf } from "@/lib/options/blackScholes";
import {
  addCalendarMonths,
  calendarDaysBetween,
  findQuote,
  listedStrikes,
  nearestExpiry,
  type IsoDate,
  type OptionChain,
} from "@/lib/optionChain/chain";
import { packageExpiryDelta } from "@/lib/strategyLab/deltaCurves";
import { packageShareDelta } from "@/lib/strategyLab/internal/pricing";
import { MODEL_DIVIDEND_YIELD, MODEL_RATE, underlyingModelIv } from "@/lib/strategyLab/modelAssumptions";

export type DurationId = "3m" | "6m" | "leaps" | "custom";

export type OptimizerHorizonId = "today" | "q1" | "half" | "q3" | "expiry";

export const OPTIMIZER_HORIZONS: readonly { readonly id: OptimizerHorizonId; readonly label: string; readonly remain: number }[] = [
  { id: "today", label: "Today", remain: 1 },
  { id: "q1", label: "Quarter", remain: 0.75 },
  { id: "half", label: "Halfway", remain: 0.5 },
  { id: "q3", label: "Third quarter", remain: 0.25 },
  { id: "expiry", label: "Expiry", remain: 0 },
];

export type ScoreId = "return" | "delta" | "leverage" | "probability";

export const SCORE_LABEL: Record<ScoreId, string> = {
  return: "Best return at target",
  delta: "Best delta profile",
  leverage: "Highest leverage now",
  probability: "Highest probability",
};

export type SpreadCandidate = {
  readonly key: string;
  readonly expiry: IsoDate;
  readonly longStrike: number;
  readonly shortStrike: number;
  readonly width: number;
  readonly debit: number;
  readonly debitPerShare: number;
  readonly maxProfit: number;
  readonly profitToDebit: number;
  readonly breakeven: number;
  readonly breakevenDistance: number;
  readonly pop: number;
  readonly probShort: number;
  readonly expectedPnl: number;
  readonly returnAtTarget: number;
  readonly thetaPerDay: number;
  readonly vegaPerPoint: number;
  readonly bidAskRatio: number | null;
  readonly longOpenInterest: number | null;
  readonly shortOpenInterest: number | null;
  readonly longDelta: number;
  readonly shortDelta: number;
  readonly netDelta: number;
  readonly leverage: number;
  readonly deltaJustInside: number;
  readonly deltaAtShortExpiry: number;
  readonly scores: Readonly<Record<ScoreId, number>>;
  readonly iv: number;
  /** True for the spread the user picked. Scan rows are never selected. */
  readonly selected: boolean;
  /** How this pair sits relative to the picked spread. Scan rows are "scan". */
  readonly variation: "scan" | "selected" | "shift" | "long" | "short";
  /** Listed-strike steps. Positive shift moves both legs up. Positive long/short moves that strike up. */
  readonly variationSteps: number;
};

export type SpreadVariation = {
  readonly longStrike: number;
  readonly shortStrike: number;
  readonly kind: "selected" | "shift" | "long" | "short";
  readonly steps: number;
};

/** How many listed strikes to step when building a neighborhood around a picked spread. */
export const VARIATION_REACH = 2;

export type SpreadScan = {
  readonly expiry: IsoDate;
  readonly iv: number | null;
  readonly years: number;
  readonly rows: readonly SpreadCandidate[];
  readonly skipped: number;
};

const LONG_LO = 0.75;
const LONG_HI = 1.02;
const SHORT_HI = 1.8;
const MAX_SIDE = 12;

const CALL_LEGS = (longStrike: number, shortStrike: number) =>
  [
    { right: "C" as const, strike: longStrike, ratio: 1 },
    { right: "C" as const, strike: shortStrike, ratio: -1 },
  ];

export function expiryForDuration(chain: OptionChain, duration: DurationId, custom: IsoDate | null): IsoDate | null {
  if (chain.expiries.length === 0) return null;
  const dates = [...chain.expiries.map((expiry) => expiry.date)].sort();
  if (duration === "leaps") return dates[dates.length - 1]!;
  if (duration === "custom") return custom ? nearestExpiry(chain, custom) : dates[dates.length - 1]!;
  const months = duration === "3m" ? 3 : 6;
  return nearestExpiry(chain, addCalendarMonths(chain.tradeDate, months));
}

/** Blank or junk means every pair in the strike band. Positive numbers are widths. */
export function parseWidths(text: string): number[] | null {
  const widths = text
    .split(/[\s,]+/)
    .map((part) => Number(part))
    .filter((width) => Number.isFinite(width) && width > 0);
  return widths.length > 0 ? widths : null;
}

export function scanCallSpreads(input: {
  readonly chain: OptionChain;
  readonly expiry: IsoDate;
  readonly widths: readonly number[] | null;
  readonly minOpenInterest: number;
  readonly maxBidAsk: number | null;
  readonly targetSpot: number;
  readonly horizon: OptimizerHorizonId;
}): SpreadScan {
  const iv = underlyingModelIv(input.chain);
  const years = calendarDaysBetween(input.chain.tradeDate, input.expiry) / 365;
  if (iv == null || !(years > 0)) return { expiry: input.expiry, iv, years, rows: [], skipped: 0 };
  const strikes = listedStrikes(input.chain, input.expiry, "C");
  const pairs = candidatePairs(strikes, input.chain.spot, input.widths);
  const rows: SpreadCandidate[] = [];
  let skipped = 0;
  for (const pair of pairs) {
    const row = pricePair(input, pair.longStrike, pair.shortStrike, iv, years);
    if (!row) {
      skipped += 1;
      continue;
    }
    rows.push(row);
  }
  return { expiry: input.expiry, iv, years, rows, skipped };
}

export function rankSpreads(rows: readonly SpreadCandidate[], score: ScoreId): SpreadCandidate[] {
  return [...rows].sort(
    (a, b) => b.scores[score] - a.scores[score] || a.longStrike - b.longStrike || a.shortStrike - b.shortStrike,
  );
}

/** The picked spread stays first. The rest keep the score order. */
export function pinSelected(rows: readonly SpreadCandidate[]): SpreadCandidate[] {
  const selected = rows.filter((row) => row.selected);
  if (selected.length === 0) return [...rows];
  return [...selected, ...rows.filter((row) => !row.selected)];
}

/**
 * Neighborhood of a listed call debit spread.
 * Shifts move both strikes by the same number of listed strikes.
 * Long and short steps widen or narrow the width by moving one strike.
 * The picked pair is first and is the only `selected` row.
 */
export function callSpreadVariations(
  strikes: readonly number[],
  longStrike: number,
  shortStrike: number,
  reach = VARIATION_REACH,
): SpreadVariation[] {
  const listed = [...new Set(strikes)].sort((a, b) => a - b);
  const longIndex = listed.findIndex((strike) => Math.abs(strike - longStrike) < 1e-6);
  const shortIndex = listed.findIndex((strike) => Math.abs(strike - shortStrike) < 1e-6);
  if (longIndex < 0 || shortIndex <= longIndex) return [];
  const out: SpreadVariation[] = [
    { longStrike: listed[longIndex]!, shortStrike: listed[shortIndex]!, kind: "selected", steps: 0 },
  ];
  const seen = new Set([`${listed[longIndex]}|${listed[shortIndex]}`]);
  const add = (longAt: number, shortAt: number, kind: SpreadVariation["kind"], steps: number) => {
    if (longAt < 0 || shortAt < 0 || longAt >= listed.length || shortAt >= listed.length || !(shortAt > longAt)) return;
    const key = `${listed[longAt]}|${listed[shortAt]}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ longStrike: listed[longAt]!, shortStrike: listed[shortAt]!, kind, steps });
  };
  const span = Math.max(1, Math.floor(reach));
  for (let step = -span; step <= span; step++) {
    if (step === 0) continue;
    add(longIndex + step, shortIndex + step, "shift", step);
  }
  for (let step = 1; step <= span; step++) {
    add(longIndex, shortIndex + step, "short", step);
    add(longIndex, shortIndex - step, "short", -step);
    add(longIndex - step, shortIndex, "long", -step);
    add(longIndex + step, shortIndex, "long", step);
  }
  return out;
}

export function variationCaption(kind: SpreadCandidate["variation"], steps: number): string {
  if (kind === "scan") return "";
  if (kind === "selected") return "Selected";
  const signed = steps > 0 ? `+${steps}` : String(steps);
  if (kind === "shift") return `Both strikes ${signed}`;
  if (kind === "long") return `Long strike ${signed}`;
  return `Short strike ${signed}`;
}

/**
 * Price the picked spread and the strikes stepped around it.
 * The pick is kept whenever it has a debit, even if the liquidity filters would drop it.
 */
export function scanAnchoredCallSpreads(input: {
  readonly chain: OptionChain;
  readonly expiry: IsoDate;
  readonly longStrike: number;
  readonly shortStrike: number;
  readonly minOpenInterest: number;
  readonly maxBidAsk: number | null;
  readonly targetSpot: number;
  readonly horizon: OptimizerHorizonId;
  readonly reach?: number;
}): SpreadScan {
  const iv = underlyingModelIv(input.chain);
  const years = calendarDaysBetween(input.chain.tradeDate, input.expiry) / 365;
  if (iv == null || !(years > 0)) return { expiry: input.expiry, iv, years, rows: [], skipped: 0 };
  const strikes = listedStrikes(input.chain, input.expiry, "C");
  const variations = callSpreadVariations(strikes, input.longStrike, input.shortStrike, input.reach ?? VARIATION_REACH);
  const rows: SpreadCandidate[] = [];
  let skipped = 0;
  for (const variation of variations) {
    const relaxed = variation.kind === "selected";
    const row = pricePair(
      relaxed ? { ...input, minOpenInterest: 0, maxBidAsk: null } : input,
      variation.longStrike,
      variation.shortStrike,
      iv,
      years,
      {
        selected: variation.kind === "selected",
        variation: variation.kind,
        variationSteps: variation.steps,
      },
    );
    if (!row) {
      skipped += 1;
      continue;
    }
    rows.push(row);
  }
  return { expiry: input.expiry, iv, years, rows, skipped };
}

export function yearsRemaining(fullYears: number, horizon: OptimizerHorizonId): number {
  const remain = OPTIMIZER_HORIZONS.find((item) => item.id === horizon)?.remain ?? 0;
  return Math.max(0, fullYears * remain);
}

/** Share-equivalent net delta. Expiry is the exact step; earlier dates keep the one lab vol. */
export function spreadShareDelta(
  longStrike: number,
  shortStrike: number,
  spot: number,
  years: number,
  iv: number,
): number {
  if (!(years > 1e-8)) return packageExpiryDelta(CALL_LEGS(longStrike, shortStrike), spot);
  const delta = packageShareDelta(
    CALL_LEGS(longStrike, shortStrike).map((leg) => ({ ...leg, iv })),
    { rate: MODEL_RATE, dividendYield: MODEL_DIVIDEND_YIELD, ivSource: "mid" },
    spot,
    years,
  );
  return delta ?? 0;
}

export const READOUT_MOVES = [-0.2, -0.1, -0.05, 0, 0.05, 0.1, 0.2] as const;

export function deltaReadoutAt(
  row: SpreadCandidate,
  spot: number,
  years: number,
): readonly { readonly label: string; readonly spot: number; readonly delta: number }[] {
  const moves = READOUT_MOVES.map((move) => {
    const at = spot * (1 + move);
    const label = move === 0 ? "Spot" : `${move > 0 ? "+" : ""}${Math.round(move * 100)}%`;
    return { label, spot: at, delta: spreadShareDelta(row.longStrike, row.shortStrike, at, years, row.iv) };
  });
  return [
    ...moves,
    {
      label: "Short strike",
      spot: row.shortStrike,
      delta: spreadShareDelta(row.longStrike, row.shortStrike, row.shortStrike, years, row.iv),
    },
  ];
}

export function deltaReadout(
  row: SpreadCandidate,
  spot: number,
  fullYears: number,
  horizon: OptimizerHorizonId,
): readonly { readonly label: string; readonly spot: number; readonly delta: number }[] {
  return deltaReadoutAt(row, spot, yearsRemaining(fullYears, horizon));
}

/** Share-equivalent delta along a spot path at one remaining maturity. */
export function deltaAlong(
  row: SpreadCandidate,
  spots: readonly number[],
  years: number,
): readonly { readonly spot: number; readonly delta: number }[] {
  return spots.map((spot) => ({
    spot,
    delta: spreadShareDelta(row.longStrike, row.shortStrike, spot, years, row.iv),
  }));
}

export function deltaPath(
  row: SpreadCandidate,
  spots: readonly number[],
  fullYears: number,
  horizon: OptimizerHorizonId,
): readonly { readonly spot: number; readonly delta: number }[] {
  return deltaAlong(row, spots, yearsRemaining(fullYears, horizon));
}

export function pathSpots(spot: number, rows: readonly Pick<SpreadCandidate, "longStrike" | "shortStrike">[]): number[] {
  const longs = rows.map((row) => row.longStrike);
  const shorts = rows.map((row) => row.shortStrike);
  const lo = Math.min(spot * 0.7, ...(longs.length ? longs.map((strike) => strike * 0.9) : [spot * 0.7]));
  const hi = Math.max(spot * 1.35, ...(shorts.length ? shorts.map((strike) => strike * 1.08) : [spot * 1.35]));
  const count = 48;
  const spots = new Set<number>();
  for (let i = 0; i < count; i++) spots.add(round2(lo + ((hi - lo) * i) / (count - 1)));
  for (const strike of shorts) {
    spots.add(round2(strike));
    spots.add(round2(Math.max(lo, strike - 0.05)));
  }
  return [...spots].filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
}

function pricePair(
  input: {
    readonly chain: OptionChain;
    readonly expiry: IsoDate;
    readonly minOpenInterest: number;
    readonly maxBidAsk: number | null;
    readonly targetSpot: number;
    readonly horizon: OptimizerHorizonId;
  },
  longStrike: number,
  shortStrike: number,
  iv: number,
  years: number,
  mark: { readonly selected: boolean; readonly variation: SpreadCandidate["variation"]; readonly variationSteps: number } = {
    selected: false,
    variation: "scan",
    variationSteps: 0,
  },
): SpreadCandidate | null {
  const longQuote = findQuote(input.chain, input.expiry, "C", longStrike);
  const shortQuote = findQuote(input.chain, input.expiry, "C", shortStrike);
  if (longQuote?.mid == null || shortQuote?.mid == null) return null;
  const debitPerShare = longQuote.mid - shortQuote.mid;
  if (!(debitPerShare > 0)) return null;
  const debit = debitPerShare * 100;
  const bidAskRatio = widerSpread(longQuote, shortQuote);
  if (input.maxBidAsk != null && bidAskRatio != null && bidAskRatio > input.maxBidAsk) return null;
  const minOi = input.minOpenInterest;
  if (minOi > 0) {
    if (longQuote.openInterest == null || shortQuote.openInterest == null) return null;
    if (longQuote.openInterest < minOi || shortQuote.openInterest < minOi) return null;
  }
  const width = shortStrike - longStrike;
  const maxProfit = width * 100 - debit;
  const breakeven = longStrike + debitPerShare;
  const canProfit = breakeven < shortStrike - 1e-6;
  const pop = canProfit ? probAbove(input.chain.spot, breakeven, years, iv) : 0;
  const probShort = probAbove(input.chain.spot, shortStrike, years, iv);
  const modelPerShare = modelPrice(longStrike, input.chain.spot, years, iv) - modelPrice(shortStrike, input.chain.spot, years, iv);
  const expectedPnl = Math.exp(MODEL_RATE * years) * modelPerShare * 100 - debit;
  const remain = yearsRemaining(years, input.horizon);
  const marked =
    remain > 1e-8
      ? (modelPrice(longStrike, input.targetSpot, remain, iv) - modelPrice(shortStrike, input.targetSpot, remain, iv)) * 100
      : expiryPackageValue(longStrike, shortStrike, input.targetSpot);
  const returnAtTarget = (marked - debit) / debit;
  const nowLong = bsmGreeks(greeksInput(longStrike, input.chain.spot, years, iv));
  const nowShort = bsmGreeks(greeksInput(shortStrike, input.chain.spot, years, iv));
  const thetaPerDay = ((nowLong.thetaPerYear - nowShort.thetaPerYear) / 365) * 100;
  const vegaPerPoint = (nowLong.vega - nowShort.vega) * 0.01 * 100;
  const inside = shortStrike - Math.min(0.01, (shortStrike - longStrike) / 2);
  const deltaJustInside = packageExpiryDelta(CALL_LEGS(longStrike, shortStrike), inside);
  const deltaAtShortExpiry = packageExpiryDelta(CALL_LEGS(longStrike, shortStrike), shortStrike);
  const netDelta = (nowLong.delta - nowShort.delta) * 100;
  const leverage = debit > 0 ? (netDelta * input.chain.spot) / debit : 0;
  const profileSpots = [input.chain.spot, input.targetSpot, inside];
  const remainProfile = yearsRemaining(years, input.horizon);
  const deltaProfile =
    profileSpots.reduce(
      (sum, spot) => sum + spreadShareDelta(longStrike, shortStrike, spot, remainProfile, iv),
      0,
    ) / profileSpots.length;
  return {
    key: `${input.expiry}|${longStrike}|${shortStrike}`,
    expiry: input.expiry,
    longStrike,
    shortStrike,
    width,
    debit,
    debitPerShare,
    maxProfit,
    profitToDebit: maxProfit / debit,
    breakeven,
    breakevenDistance: breakeven - input.chain.spot,
    pop,
    probShort,
    expectedPnl,
    returnAtTarget,
    thetaPerDay,
    vegaPerPoint,
    bidAskRatio,
    longOpenInterest: longQuote.openInterest,
    shortOpenInterest: shortQuote.openInterest,
    longDelta: nowLong.delta,
    shortDelta: nowShort.delta,
    netDelta,
    leverage,
    deltaJustInside,
    deltaAtShortExpiry,
    scores: {
      return: returnAtTarget,
      delta: deltaProfile,
      leverage,
      probability: pop,
    },
    iv,
    selected: mark.selected,
    variation: mark.variation,
    variationSteps: mark.variationSteps,
  };
}

function expiryPackageValue(longStrike: number, shortStrike: number, spot: number): number {
  const intrinsic = (strike: number) => Math.max(spot - strike, 0);
  return (intrinsic(longStrike) - intrinsic(shortStrike)) * 100;
}

function modelPrice(strike: number, spot: number, years: number, iv: number): number {
  return bsmGreeks(greeksInput(strike, spot, years, iv)).price;
}

function greeksInput(strike: number, spot: number, years: number, iv: number) {
  return {
    right: "C" as const,
    spot,
    strike,
    years,
    rate: MODEL_RATE,
    dividendYield: MODEL_DIVIDEND_YIELD,
    vol: iv,
  };
}

/** Risk-neutral probability the terminal spot finishes above the level. */
function probAbove(spot: number, level: number, years: number, iv: number): number {
  if (!(level > 0) || !(spot > 0) || !(iv > 0)) return 0;
  if (!(years > 1e-8)) return spot > level ? 1 : 0;
  const d2 =
    (Math.log(spot / level) + (MODEL_RATE - MODEL_DIVIDEND_YIELD - 0.5 * iv * iv) * years) / (iv * Math.sqrt(years));
  return normCdf(d2);
}

function widerSpread(
  longQuote: { bid: number | null; ask: number | null; mid: number | null },
  shortQuote: { bid: number | null; ask: number | null; mid: number | null },
): number | null {
  const ratio = (quote: { bid: number | null; ask: number | null; mid: number | null }) => {
    if (quote.bid == null || quote.ask == null || quote.mid == null || !(quote.mid > 0)) return null;
    return (quote.ask - quote.bid) / quote.mid;
  };
  const a = ratio(longQuote);
  const b = ratio(shortQuote);
  if (a == null && b == null) return null;
  return Math.max(a ?? 0, b ?? 0);
}

function candidatePairs(
  strikes: readonly number[],
  spot: number,
  widths: readonly number[] | null,
): readonly { readonly longStrike: number; readonly shortStrike: number }[] {
  const longs = bandStrikes(
    strikes.filter((strike) => strike >= spot * LONG_LO && strike <= spot * LONG_HI),
    spot,
    strikes,
  );
  const seen = new Set<string>();
  const pairs: { longStrike: number; shortStrike: number }[] = [];
  const add = (longStrike: number, shortStrike: number) => {
    if (!(shortStrike > longStrike)) return;
    const key = `${longStrike}|${shortStrike}`;
    if (seen.has(key)) return;
    seen.add(key);
    pairs.push({ longStrike, shortStrike });
  };
  if (widths && widths.length > 0) {
    const above = [...strikes].sort((a, b) => a - b);
    for (const longStrike of longs) {
      for (const width of widths) {
        const want = longStrike + width;
        const shortStrike = above
          .filter((strike) => strike > longStrike + 1e-6)
          .sort((a, b) => Math.abs(a - want) - Math.abs(b - want) || a - b)[0];
        if (shortStrike != null) add(longStrike, shortStrike);
      }
    }
    return pairs;
  }
  const shorts = bandStrikes(
    strikes.filter((strike) => strike > spot * LONG_LO && strike <= spot * SHORT_HI),
    spot,
    strikes,
  );
  for (const longStrike of longs) {
    for (const shortStrike of shorts) add(longStrike, shortStrike);
  }
  return pairs;
}

function bandStrikes(preferred: readonly number[], spot: number, fallback: readonly number[]): number[] {
  const pool = preferred.length > 0 ? preferred : fallback;
  return [...pool]
    .sort((a, b) => Math.abs(a - spot) - Math.abs(b - spot) || a - b)
    .slice(0, MAX_SIDE)
    .sort((a, b) => a - b);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

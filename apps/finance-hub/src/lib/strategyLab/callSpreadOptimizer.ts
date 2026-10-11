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
  leverage: "Cheapest leverage",
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
};

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
  const long = contractDelta(longStrike, spot, years, iv);
  const short = contractDelta(shortStrike, spot, years, iv);
  return (long - short) * 100;
}

export const READOUT_MOVES = [-0.2, -0.1, -0.05, 0, 0.05, 0.1, 0.2] as const;

export function deltaReadout(
  row: SpreadCandidate,
  spot: number,
  fullYears: number,
  horizon: OptimizerHorizonId,
): readonly { readonly label: string; readonly spot: number; readonly delta: number }[] {
  const years = yearsRemaining(fullYears, horizon);
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

export function deltaPath(
  row: SpreadCandidate,
  spots: readonly number[],
  fullYears: number,
  horizon: OptimizerHorizonId,
): readonly { readonly spot: number; readonly delta: number }[] {
  const years = yearsRemaining(fullYears, horizon);
  return spots.map((spot) => ({
    spot,
    delta: spreadShareDelta(row.longStrike, row.shortStrike, spot, years, row.iv),
  }));
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
  const leverage = debit > 0 ? (deltaJustInside * shortStrike) / debit : 0;
  const netDelta = (nowLong.delta - nowShort.delta) * 100;
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
  };
}

function expiryPackageValue(longStrike: number, shortStrike: number, spot: number): number {
  const intrinsic = (strike: number) => Math.max(spot - strike, 0);
  return (intrinsic(longStrike) - intrinsic(shortStrike)) * 100;
}

function modelPrice(strike: number, spot: number, years: number, iv: number): number {
  return bsmGreeks(greeksInput(strike, spot, years, iv)).price;
}

function contractDelta(strike: number, spot: number, years: number, iv: number): number {
  return bsmGreeks(greeksInput(strike, spot, years, iv)).delta;
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

/** Short-strangle (and generic multi-leg) expiration + approximate T+0 risk profile. */

export type RiskProfileLeg = {
  right: "C" | "P";
  strike: number;
  /** Signed quantity (short = negative). */
  quantity: number;
  /** Average entry price per share. */
  entryPrice: number;
  /** Current mark per share (absolute). */
  markPrice: number | null;
  /** Implied vol as a decimal (0.15 = 15%). */
  iv: number | null;
};

export type RiskProfilePoint = {
  spot: number;
  expirationPnl: number;
  t0Pnl: number | null;
};

export type RiskProfileModel = {
  points: RiskProfilePoint[];
  spot: number | null;
  putStrike: number | null;
  callStrike: number | null;
  /** Max credit received (positive dollars) for a short premium book. */
  maxProfit: number | null;
  /** Current unrealized P&L dollars. */
  currentPnl: number | null;
  /** Current P&L as % of max profit (credit). */
  currentPnlPctOfMax: number | null;
  profitTargetPnl: number | null;
  profitTargetPct: number;
  lowerBreakeven: number | null;
  upperBreakeven: number | null;
  dte: number | null;
};

export function erf(x: number): number {
  // Abramowitz & Stegun 7.1.26
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t) *
      Math.exp(-ax * ax);
  return sign * y;
}

export function normCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

/** European Black–Scholes price per share. */
export function blackScholesPrice(
  right: "C" | "P",
  spot: number,
  strike: number,
  years: number,
  rate: number,
  iv: number,
): number {
  if (!(spot > 0) || !(strike > 0) || !(iv > 0)) {
    const intrinsic = right === "C" ? Math.max(spot - strike, 0) : Math.max(strike - spot, 0);
    return intrinsic;
  }
  if (!(years > 1e-8)) {
    return right === "C" ? Math.max(spot - strike, 0) : Math.max(strike - spot, 0);
  }
  const sqrtT = Math.sqrt(years);
  const d1 = (Math.log(spot / strike) + (rate + 0.5 * iv * iv) * years) / (iv * sqrtT);
  const d2 = d1 - iv * sqrtT;
  if (right === "C") {
    return spot * normCdf(d1) - strike * Math.exp(-rate * years) * normCdf(d2);
  }
  return strike * Math.exp(-rate * years) * normCdf(-d2) - spot * normCdf(-d1);
}

/** Contract delta (call +ve, put -ve) — underwriting delta, not position delta. */
export function blackScholesDelta(
  right: "C" | "P",
  spot: number,
  strike: number,
  years: number,
  rate: number,
  iv: number,
): number | null {
  if (!(spot > 0) || !(strike > 0) || !(iv > 0) || !(years > 1e-8)) return null;
  const sqrtT = Math.sqrt(years);
  const d1 = (Math.log(spot / strike) + (rate + 0.5 * iv * iv) * years) / (iv * sqrtT);
  if (right === "C") return normCdf(d1);
  return normCdf(d1) - 1;
}

/**
 * Solve implied vol from a fill premium via bisection on Black-Scholes.
 * Returns null when the premium is unattainable / inputs are invalid.
 */
export function impliedVolFromPrice(
  right: "C" | "P",
  spot: number,
  strike: number,
  years: number,
  rate: number,
  price: number,
): number | null {
  if (!(spot > 0) || !(strike > 0) || !(years > 1e-8) || !(price >= 0) || !Number.isFinite(price)) {
    return null;
  }
  const intrinsic = right === "C" ? Math.max(spot - strike, 0) : Math.max(strike - spot, 0);
  // Allow tiny below-intrinsic noise from fees/marks
  if (price < intrinsic - 0.02) return null;

  let lo = 1e-4;
  let hi = 5;
  const pLo = blackScholesPrice(right, spot, strike, years, rate, lo);
  const pHi = blackScholesPrice(right, spot, strike, years, rate, hi);
  if (price <= pLo) return lo;
  if (price >= pHi) return hi;

  for (let i = 0; i < 60; i++) {
    const mid = 0.5 * (lo + hi);
    const p = blackScholesPrice(right, spot, strike, years, rate, mid);
    if (Math.abs(p - price) < 1e-6) return mid;
    if (p > price) hi = mid;
    else lo = mid;
  }
  return 0.5 * (lo + hi);
}

function legExpirationValue(right: "C" | "P", strike: number, spot: number): number {
  return right === "C" ? Math.max(spot - strike, 0) : Math.max(strike - spot, 0);
}

/** P&L dollars at a given theoretical per-share mark for one leg. */
export function legPnlAtMark(leg: RiskProfileLeg, markPerShare: number): number {
  // cost basis = entry * qty * 100; mark MV = mark * qty * 100
  return (markPerShare - leg.entryPrice) * leg.quantity * 100;
}

export function bookCreditDollars(legs: RiskProfileLeg[]): number | null {
  let credit = 0;
  let any = false;
  for (const leg of legs) {
    if (!(leg.entryPrice > 0) || leg.quantity === 0) continue;
    // Short premium: qty < 0 → credit received = -entry*qty*100
    credit += -leg.entryPrice * leg.quantity * 100;
    any = true;
  }
  return any ? Math.round(credit * 100) / 100 : null;
}

export function bookCurrentPnl(legs: RiskProfileLeg[]): number | null {
  let sum = 0;
  let any = false;
  for (const leg of legs) {
    if (leg.markPrice == null || !Number.isFinite(leg.markPrice)) continue;
    sum += legPnlAtMark(leg, leg.markPrice);
    any = true;
  }
  return any ? Math.round(sum * 100) / 100 : null;
}

export function expirationPnlAtSpot(legs: RiskProfileLeg[], spot: number): number {
  let sum = 0;
  for (const leg of legs) {
    const mark = legExpirationValue(leg.right, leg.strike, spot);
    sum += legPnlAtMark(leg, mark);
  }
  return Math.round(sum * 100) / 100;
}

export function t0PnlAtSpot(
  legs: RiskProfileLeg[],
  spot: number,
  dte: number,
  rate = 0.045,
): number | null {
  if (!(dte >= 0) || !Number.isFinite(dte)) return null;
  const years = Math.max(dte, 0) / 365;
  let sum = 0;
  let any = false;
  for (const leg of legs) {
    const iv = leg.iv != null && leg.iv > 0 ? (leg.iv > 1.5 ? leg.iv / 100 : leg.iv) : null;
    if (iv == null) return null;
    const mark = blackScholesPrice(leg.right, spot, leg.strike, years, rate, iv);
    sum += legPnlAtMark(leg, mark);
    any = true;
  }
  return any ? Math.round(sum * 100) / 100 : null;
}

function pickStrikes(legs: RiskProfileLeg[]): { put: number | null; call: number | null } {
  let put: number | null = null;
  let call: number | null = null;
  for (const leg of legs) {
    if (leg.quantity >= 0) continue;
    if (leg.right === "P") put = put == null ? leg.strike : Math.min(put, leg.strike);
    if (leg.right === "C") call = call == null ? leg.strike : Math.max(call, leg.strike);
  }
  return { put, call };
}

function breakevens(
  legs: RiskProfileLeg[],
  put: number | null,
  call: number | null,
  credit: number | null,
): { lower: number | null; upper: number | null } {
  if (credit == null || credit <= 0) return { lower: null, upper: null };
  // Per short strangle (equal abs qty assumed): credit per share ≈ credit / (absQty * 100)
  const shortPut = legs.find((l) => l.quantity < 0 && l.right === "P");
  const shortCall = legs.find((l) => l.quantity < 0 && l.right === "C");
  const putQty = shortPut ? Math.abs(shortPut.quantity) : 0;
  const callQty = shortCall ? Math.abs(shortCall.quantity) : 0;
  const qty = Math.max(putQty, callQty, 1);
  const creditPerShare = credit / (qty * 100);
  return {
    lower: put != null ? put - creditPerShare : null,
    upper: call != null ? call + creditPerShare : null,
  };
}

/**
 * Build a ToS-style risk profile for a short strangle (works for any short-premium multi-leg book).
 * Domain spans half the prior wing pad past the outer strikes (or spot), sampled densely for a smooth chart.
 */
export function buildShortStrangleRiskProfile(input: {
  legs: RiskProfileLeg[];
  spot: number | null;
  dte: number | null;
  profitTargetPct?: number;
  samples?: number;
}): RiskProfileModel {
  const profitTargetPct = input.profitTargetPct ?? 50;
  const samples = input.samples ?? 121;
  const { put, call } = pickStrikes(input.legs);
  const maxProfit = bookCreditDollars(input.legs);
  const currentPnl = bookCurrentPnl(input.legs);
  const currentPnlPctOfMax =
    maxProfit != null && maxProfit > 0 && currentPnl != null
      ? Math.round((currentPnl / maxProfit) * 1000) / 10
      : null;
  const profitTargetPnl =
    maxProfit != null && maxProfit > 0 ? Math.round(maxProfit * (profitTargetPct / 100) * 100) / 100 : null;
  const { lower, upper } = breakevens(input.legs, put, call, maxProfit);

  const anchors = [input.spot, put, call, lower, upper].filter(
    (v): v is number => v != null && Number.isFinite(v) && v > 0,
  );
  const mid = anchors.length ? anchors.reduce((a, b) => a + b, 0) / anchors.length : 100;
  const loStrike = Math.min(...anchors, mid);
  const hiStrike = Math.max(...anchors, mid);
  const pad = Math.max((hiStrike - loStrike) * 0.0875, mid * 0.015);
  const x0 = Math.max(1, loStrike - pad);
  const x1 = hiStrike + pad;

  const points: RiskProfilePoint[] = [];
  for (let i = 0; i < samples; i++) {
    const spot = x0 + ((x1 - x0) * i) / (samples - 1);
    points.push({
      spot: Math.round(spot * 100) / 100,
      expirationPnl: expirationPnlAtSpot(input.legs, spot),
      t0Pnl: input.dte != null ? t0PnlAtSpot(input.legs, spot, input.dte) : null,
    });
  }

  return {
    points,
    spot: input.spot,
    putStrike: put,
    callStrike: call,
    maxProfit,
    currentPnl,
    currentPnlPctOfMax,
    profitTargetPnl,
    profitTargetPct,
    lowerBreakeven: lower != null ? Math.round(lower * 100) / 100 : null,
    upperBreakeven: upper != null ? Math.round(upper * 100) / 100 : null,
    dte: input.dte,
  };
}

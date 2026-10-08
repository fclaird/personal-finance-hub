/**
 * The only Black–Scholes implementation in the hub.
 * Continuous dividend yield q is in the formula. Callers that want the old
 * no-dividend behavior pass dividendYield: 0 and their own rate.
 */

export type OptionRight = "C" | "P";

export type BsmInput = {
  readonly right: OptionRight;
  readonly spot: number;
  readonly strike: number;
  /** Year fraction. `<= 0` prices at intrinsic and zeroes greeks. */
  readonly years: number;
  /** Continuous risk-free rate, decimal (0.04). */
  readonly rate: number;
  /** Continuous dividend yield, decimal (0 for NOW, 0.007 for AVGO). */
  readonly dividendYield: number;
  /** Annualized vol, decimal. `<= 0` prices at intrinsic. */
  readonly vol: number;
};

export type BsmGreeks = {
  readonly price: number;
  /** e^(−qT)·N(d1) for calls; e^(−qT)·(N(d1) − 1) for puts. */
  readonly delta: number;
  /** e^(−qT)·φ(d1) / (S σ √T). */
  readonly gamma: number;
  /** ∂V/∂t per year. Divide by 365 for dollars per calendar day. */
  readonly thetaPerYear: number;
  /** ∂V/∂σ per 1.00 of vol. Multiply by 0.01 for one vol point. */
  readonly vega: number;
};

export type ImpliedVolResult =
  | { readonly ok: true; readonly vol: number; readonly clamped: null | "floor" | "ceiling" }
  | { readonly ok: false; readonly reason: "invalidInput" | "expired" | "belowIntrinsic" };

export function erf(x: number): number {
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

export function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

function intrinsic(right: OptionRight, spot: number, strike: number): number {
  return right === "C" ? Math.max(spot - strike, 0) : Math.max(strike - spot, 0);
}

function badPriceInputs(input: BsmInput): boolean {
  return !(input.spot > 0) || !(input.strike > 0) || !Number.isFinite(input.rate) || !Number.isFinite(input.dividendYield);
}

/** European Black–Scholes–Merton price per share. */
export function bsmPrice(input: BsmInput): number {
  if (badPriceInputs(input) || !(input.vol > 0)) {
    const spot = input.spot > 0 ? input.spot : 0;
    const strike = input.strike > 0 ? input.strike : 0;
    return intrinsic(input.right, spot, strike);
  }
  if (!(input.years > 1e-8)) return intrinsic(input.right, input.spot, input.strike);
  return bsmGreeks(input).price;
}

/** Price and greeks in one pass. */
export function bsmGreeks(input: BsmInput): BsmGreeks {
  const spot = input.spot > 0 ? input.spot : 0;
  const strike = input.strike > 0 ? input.strike : 0;
  const expired: BsmGreeks = {
    price: intrinsic(input.right, spot, strike),
    delta: 0,
    gamma: 0,
    thetaPerYear: 0,
    vega: 0,
  };
  if (badPriceInputs(input) || !(input.vol > 0) || !(input.years > 1e-8)) return expired;

  const { right, years, rate, dividendYield, vol } = input;
  const sqrtT = Math.sqrt(years);
  const dfR = Math.exp(-rate * years);
  const dfQ = Math.exp(-dividendYield * years);
  const d1 = (Math.log(input.spot / input.strike) + (rate - dividendYield + 0.5 * vol * vol) * years) / (vol * sqrtT);
  const d2 = d1 - vol * sqrtT;
  const nd1 = normCdf(d1);
  const pdf = normPdf(d1);
  const gamma = (dfQ * pdf) / (input.spot * vol * sqrtT);
  const vega = input.spot * dfQ * pdf * sqrtT;
  const decay = (-input.spot * dfQ * pdf * vol) / (2 * sqrtT);

  if (right === "C") {
    const price = input.spot * dfQ * nd1 - input.strike * dfR * normCdf(d2);
    const delta = dfQ * nd1;
    const thetaPerYear = decay - rate * input.strike * dfR * normCdf(d2) + dividendYield * input.spot * dfQ * nd1;
    return { price, delta, gamma, thetaPerYear, vega };
  }
  const price = input.strike * dfR * normCdf(-d2) - input.spot * dfQ * normCdf(-d1);
  const delta = dfQ * (nd1 - 1);
  const thetaPerYear = decay + rate * input.strike * dfR * normCdf(-d2) - dividendYield * input.spot * dfQ * normCdf(-d1);
  return { price, delta, gamma, thetaPerYear, vega };
}

/**
 * Bisection. A price up to $0.02 under intrinsic is tolerated.
 * The solution is clamped to [1e-4, 5] and the clamp is reported.
 */
export function impliedVol(input: Omit<BsmInput, "vol"> & { readonly price: number }): ImpliedVolResult {
  const { price } = input;
  if (!(input.spot > 0) || !(input.strike > 0) || !Number.isFinite(price) || price < 0) {
    return { ok: false, reason: "invalidInput" };
  }
  if (!(input.years > 1e-8)) return { ok: false, reason: "expired" };
  const floor = intrinsic(input.right, input.spot, input.strike);
  if (price < floor - 0.02) return { ok: false, reason: "belowIntrinsic" };

  const at = (vol: number) => bsmPrice({ ...input, vol });
  let lo = 1e-4;
  let hi = 5;
  const pLo = at(lo);
  const pHi = at(hi);
  if (price <= pLo) return { ok: true, vol: lo, clamped: "floor" };
  if (price >= pHi) return { ok: true, vol: hi, clamped: "ceiling" };

  for (let i = 0; i < 60; i++) {
    const mid = 0.5 * (lo + hi);
    const p = at(mid);
    if (Math.abs(p - price) < 1e-6) return { ok: true, vol: mid, clamped: null };
    if (p > price) hi = mid;
    else lo = mid;
  }
  return { ok: true, vol: 0.5 * (lo + hi), clamped: null };
}

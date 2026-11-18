import { bsmGreeks, type OptionRight } from "@/lib/options/blackScholes";

import type { ExerciseStyle } from "@/lib/fortress/types";

export type TreeInput = {
  readonly right: OptionRight;
  readonly style: ExerciseStyle;
  readonly spot: number;
  readonly strike: number;
  readonly years: number;
  readonly rate: number;
  readonly dividendYield: number;
  readonly vol: number;
  readonly steps: number;
};

export type TreeGreeks = {
  readonly price: number;
  /** Share delta from the first step of the tree. */
  readonly delta: number;
  readonly gamma: number;
  readonly thetaPerYear: number;
  /** ∂price/∂σ for a 1.00 vol move. Multiply by 0.01 for one vol point. */
  readonly vegaPerVol: number;
  readonly vegaPerPoint: number;
  readonly steps: number;
  readonly method: "crr-tree";
};

export type TreeResult = { readonly ok: true; readonly value: TreeGreeks } | { readonly ok: false; readonly reason: string };

function intrinsic(right: OptionRight, spot: number, strike: number): number {
  return right === "C" ? Math.max(spot - strike, 0) : Math.max(strike - spot, 0);
}

/**
 * Cox–Ross–Rubinstein tree. American nodes take max(exercise, continuation).
 * European nodes take continuation only, so they can be checked against Black–Scholes.
 * A risk-neutral probability outside (0, 1) is rejected instead of clamped.
 */
export function crrPrice(input: TreeInput): TreeResult {
  if (!(input.spot > 0) || !(input.strike > 0) || !Number.isFinite(input.rate) || !Number.isFinite(input.dividendYield)) {
    return { ok: false, reason: "Invalid spot, strike, or rate." };
  }
  if (!(input.years > 1e-8) || !(input.vol > 0)) {
    const price = intrinsic(input.right, input.spot, input.strike);
    const delta = price <= 0 ? 0 : input.right === "C" ? 1 : -1;
    return {
      ok: true,
      value: { price, delta, gamma: 0, thetaPerYear: 0, vegaPerVol: 0, vegaPerPoint: 0, steps: 0, method: "crr-tree" },
    };
  }
  const steps = Math.max(2, Math.floor(input.steps));
  const built = build(input, steps);
  if (!built) return { ok: false, reason: "The tree probability left (0, 1). Raise the step count or lower the dividend." };
  const bumped = build({ ...input, vol: input.vol + 0.01 }, steps);
  const down = build({ ...input, vol: Math.max(1e-4, input.vol - 0.01) }, steps);
  const vegaPerVol = bumped && down ? (bumped.price - down.price) / (input.vol + 0.01 - Math.max(1e-4, input.vol - 0.01)) : 0;
  return {
    ok: true,
    value: {
      ...built,
      vegaPerVol,
      vegaPerPoint: vegaPerVol * 0.01,
      steps,
      method: "crr-tree",
    },
  };
}

function build(input: TreeInput, steps: number): Omit<TreeGreeks, "vegaPerVol" | "vegaPerPoint" | "steps" | "method"> | null {
  const dt = input.years / steps;
  const u = Math.exp(input.vol * Math.sqrt(dt));
  const d = 1 / u;
  const growth = Math.exp((input.rate - input.dividendYield) * dt);
  const p = (growth - d) / (u - d);
  if (!(p > 0 && p < 1) || !Number.isFinite(p)) return null;
  const disc = Math.exp(-input.rate * dt);
  let layer = new Array<number>(steps + 1);
  for (let j = 0; j <= steps; j++) {
    const spot = input.spot * u ** j * d ** (steps - j);
    layer[j] = intrinsic(input.right, spot, input.strike);
  }
  let atTwo: number[] | null = null;
  let atOne: number[] | null = null;
  for (let i = steps - 1; i >= 0; i--) {
    const next = new Array<number>(i + 1);
    for (let j = 0; j <= i; j++) {
      const continuation = disc * (p * layer[j + 1]! + (1 - p) * layer[j]!);
      const spot = input.spot * u ** j * d ** (i - j);
      const exercise = intrinsic(input.right, spot, input.strike);
      next[j] = input.style === "american" ? Math.max(continuation, exercise) : continuation;
    }
    if (i === 2) atTwo = next;
    if (i === 1) atOne = next;
    layer = next;
  }
  const price = layer[0] ?? 0;
  const su = input.spot * u;
  const sd = input.spot * d;
  const vu = atOne?.[1] ?? price;
  const vd = atOne?.[0] ?? price;
  const delta = su === sd ? 0 : (vu - vd) / (su - sd);
  let gamma = 0;
  if (atTwo && atTwo.length === 3) {
    const suu = input.spot * u * u;
    const sud = input.spot;
    const sdd = input.spot * d * d;
    const du = suu === sud ? 0 : (atTwo[2]! - atTwo[1]!) / (suu - sud);
    const dd = sud === sdd ? 0 : (atTwo[1]! - atTwo[0]!) / (sud - sdd);
    gamma = suu === sdd ? 0 : (du - dd) / (0.5 * (suu - sdd));
  }
  const thetaPerYear = dt > 0 && atTwo ? (atTwo[1]! - price) / (2 * dt) : 0;
  return { price, delta, gamma, thetaPerYear };
}

/** European tree versus the closed form. Used only as a check, not as the listed-equity pricer. */
export function europeanClosedForm(input: Omit<TreeInput, "style" | "steps">) {
  return bsmGreeks({
    right: input.right,
    spot: input.spot,
    strike: input.strike,
    years: input.years,
    rate: input.rate,
    dividendYield: input.dividendYield,
    vol: input.vol,
  });
}

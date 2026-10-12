import { bsmGreeks, bsmPrice, impliedVol } from "@/lib/options/blackScholes";
import { optionMarginSecuredDollars } from "@/lib/options/optionMarginRoi";
import {
  calendarDaysBetween,
  findQuote,
  type IsoDate,
  type OptionChain,
  type OptionRight,
} from "@/lib/optionChain/chain";
import type { Leg } from "@/lib/strategyLab/legs";
import { MODEL_DIVIDEND_YIELD, MODEL_RATE } from "@/lib/strategyLab/modelAssumptions";

export type Assumptions = {
  readonly rate: number;
  readonly dividendYield: number;
  readonly ivSource: "mid" | "feed";
};

export type PricedLeg = {
  readonly id: string;
  readonly instrument: Leg["instrument"];
  readonly side: Leg["side"];
  readonly quantity: number;
  readonly expiry: IsoDate | null;
  readonly right: OptionRight | null;
  readonly strike: number | null;
  readonly ratio: number;
  readonly bid: number | null;
  readonly ask: number | null;
  readonly mid: number | null;
  /** Vol used for greeks and pre-expiry marks. Shared model IV, unless the leg pinned an override. */
  readonly iv: number | null;
  /** Solved from this leg's own mid. Display only. */
  readonly quoteIv: number | null;
  readonly feedIv: number | null;
  readonly ivFrom: "override" | "model" | "quote" | "feed" | null;
};

type LegIn = Leg;

function intrinsic(right: OptionRight, strike: number, spot: number): number {
  return right === "C" ? Math.max(spot - strike, 0) : Math.max(strike - spot, 0);
}

function yearsBetween(chain: OptionChain, expiry: IsoDate): number {
  return calendarDaysBetween(chain.tradeDate, expiry) / 365;
}

export function priceLegs(
  chain: OptionChain,
  legs: readonly LegIn[],
  assumptions: Assumptions,
  modelIv: number | null,
): { readonly legs: PricedLeg[]; readonly ivFallback: boolean } | { readonly error: string } {
  const out: PricedLeg[] = [];
  let ivFallback = false;
  for (const leg of legs) {
    if (leg.instrument === "stock") {
      out.push({
        id: leg.id,
        instrument: "stock",
        side: leg.side,
        quantity: leg.quantity,
        expiry: null,
        right: null,
        strike: null,
        ratio: leg.ratio,
        bid: null,
        ask: null,
        mid: leg.entry.price,
        iv: null,
        quoteIv: null,
        feedIv: null,
        ivFrom: null,
      });
      continue;
    }
    if (leg.right == null || leg.strike == null || leg.expiry == null) return { error: "An option leg needs a right, strike, and expiry." };
    const years = yearsBetween(chain, leg.expiry);
    const quote = findQuote(chain, leg.expiry, leg.right, leg.strike);
    if (!quote) return { error: `No quote for the ${leg.strike} ${leg.right}.` };
    const fromMid = (): number | null => {
      if (quote.mid == null || !(years > 1e-8)) return null;
      const solved = impliedVol({
        right: leg.right!,
        spot: chain.spot,
        strike: leg.strike!,
        years,
        rate: MODEL_RATE,
        dividendYield: MODEL_DIVIDEND_YIELD,
        price: quote.mid,
      });
      return solved.ok ? solved.vol : null;
    };
    const quoteIv = fromMid();
    const fromFeed = () => quote.feedIv;
    let iv: number | null = null;
    let ivFrom: PricedLeg["ivFrom"] = null;
    if (leg.ivOverride != null && leg.ivOverride > 0) {
      iv = leg.ivOverride;
      ivFrom = "override";
    } else if (modelIv != null && modelIv > 0) {
      iv = modelIv;
      ivFrom = "model";
    } else if (assumptions.ivSource === "mid") {
      iv = quoteIv;
      ivFrom = iv != null ? "quote" : null;
      if (iv == null && fromFeed() != null) {
        iv = fromFeed();
        ivFrom = "feed";
        ivFallback = true;
      }
    } else {
      iv = fromFeed();
      ivFrom = iv != null ? "feed" : null;
      if (iv == null) {
        iv = quoteIv;
        if (iv != null) {
          ivFrom = "quote";
          ivFallback = true;
        }
      }
    }
    out.push({
      id: leg.id,
      instrument: leg.instrument,
      side: leg.side,
      quantity: leg.quantity,
      expiry: leg.expiry,
      right: leg.right,
      strike: leg.strike,
      ratio: leg.ratio,
      bid: quote.bid,
      ask: quote.ask,
      mid: quote.mid,
      iv,
      quoteIv,
      feedIv: quote.feedIv,
      ivFrom,
    });
  }
  return { legs: out, ivFallback };
}

export function netFromLegs(legs: readonly PricedLeg[], pick: "mid" | "natural"): number | null {
  let sum = 0;
  let any = false;
  for (const leg of legs) {
    if (leg.instrument === "stock") continue;
    const px = pick === "mid" ? leg.mid : leg.ratio > 0 ? leg.ask : leg.bid;
    if (px == null) return null;
    sum += px * leg.ratio;
    any = true;
  }
  return any ? sum : null;
}

/** Signed stock dollars at the leg's average price. Options are not included. */
export function stockEntryDollars(legs: readonly Leg[]): number {
  let sum = 0;
  for (const leg of legs) {
    if (leg.instrument !== "stock" || leg.entry.price == null) continue;
    sum += leg.ratio * leg.entry.price;
  }
  return sum;
}

export function entryDollars(netPerShare: number): number {
  return Math.round(netPerShare * 100);
}

export function packageGreeks(chain: OptionChain, legs: readonly PricedLeg[], assumptions: Assumptions) {
  let delta = 0;
  let gamma = 0;
  let theta = 0;
  let vega = 0;
  for (const leg of legs) {
    if (leg.instrument === "stock") {
      delta += leg.ratio;
      continue;
    }
    if (leg.iv == null || leg.right == null || leg.strike == null || leg.expiry == null) return null;
    const years = yearsBetween(chain, leg.expiry);
    const g = bsmGreeks({
      right: leg.right,
      spot: chain.spot,
      strike: leg.strike,
      years,
      rate: assumptions.rate,
      dividendYield: assumptions.dividendYield,
      vol: leg.iv,
    });
    delta += g.delta * leg.ratio * 100;
    gamma += g.gamma * leg.ratio * 100;
    theta += (g.thetaPerYear / 365) * leg.ratio * 100;
    vega += g.vega * 0.01 * leg.ratio * 100;
  }
  return { delta, gamma, theta, vega };
}

type ValueLeg = {
  readonly right?: OptionRight | null;
  readonly strike?: number | null;
  readonly ratio: number;
  readonly instrument?: Leg["instrument"];
};

/** Intrinsic package value in dollars, before subtracting the debit. Stock is marked at spot. */
export function expiryValue(legs: readonly ValueLeg[], spot: number): number {
  let sum = 0;
  for (const leg of legs) {
    if (leg.instrument === "stock") {
      sum += leg.ratio * spot;
      continue;
    }
    if (leg.right == null || leg.strike == null) continue;
    sum += intrinsic(leg.right, leg.strike, spot) * leg.ratio * 100;
  }
  return sum;
}

export function expiryPnl(legs: readonly ValueLeg[], debit: number, spot: number): number {
  return expiryValue(legs, spot) - debit;
}

/**
 * Share-equivalent delta of the settled package from this spot to one dollar higher.
 * Starting on a strike counts the region just through it: a call spread is flat above
 * its short strike, and a ZEBRA is long 100 shares once that short call is reached.
 */
export function settledShareDelta(legs: readonly ValueLeg[], spot: number): number {
  return expiryValue(legs, spot + 1) - expiryValue(legs, spot);
}

/** Model share-equivalent delta at an arbitrary spot. IV stays the entry IV. Expired dates use the settled slope. */
export function packageShareDelta(
  legs: readonly (ValueLeg & { readonly iv?: number | null })[],
  assumptions: Assumptions,
  spot: number,
  years: number,
): number | null {
  if (!(years > 1e-8)) return settledShareDelta(legs, spot);
  let delta = 0;
  for (const leg of legs) {
    if (leg.instrument === "stock") {
      delta += leg.ratio;
      continue;
    }
    if (leg.iv == null || leg.right == null || leg.strike == null) return null;
    delta +=
      bsmGreeks({
        right: leg.right,
        spot,
        strike: leg.strike,
        years,
        rate: assumptions.rate,
        dividendYield: assumptions.dividendYield,
        vol: leg.iv,
      }).delta *
      leg.ratio *
      100;
  }
  return delta;
}

export type ExpiryRisk = {
  readonly breakevens: readonly number[];
  readonly maxLoss: number | "unbounded";
  readonly maxLossUp: number | "unbounded";
  /** Loss at spot 0 when the position loses as the stock falls. "flat" when that side does not. */
  readonly maxLossDown: number | "flat";
  readonly maxGain: number | "unbounded";
  readonly slopeAbove: number;
  readonly slopeBelow: number;
  readonly intrinsic: number;
  readonly extrinsic: number;
};

export function expiryRisk(legs: readonly ValueLeg[], debit: number, spot: number): ExpiryRisk {
  const strikes = [...new Set(legs.map((l) => l.strike).filter((strike): strike is number => strike != null))].sort((a, b) => a - b);
  const knots = [0, ...strikes];
  const pnlAt = (s: number) => expiryPnl(legs, debit, s);
  const pnls = knots.map(pnlAt);
  const hi = strikes.length ? strikes[strikes.length - 1]! : 0;
  const slopeAbove = hi > 0 ? expiryValue(legs, hi + 1) - expiryValue(legs, hi) : 0;
  const slopeBelow = strikes.length && strikes[0]! > 0 ? (expiryValue(legs, strikes[0]!) - expiryValue(legs, 0)) / strikes[0]! : 0;
  const worst = Math.min(...pnls);
  const best = Math.max(...pnls);
  const breakevens: number[] = [];
  for (let i = 0; i < knots.length - 1; i++) {
    const x0 = knots[i]!;
    const x1 = knots[i + 1]!;
    const y0 = pnls[i]!;
    const y1 = pnls[i + 1]!;
    if (Math.abs(y0) < 1e-6) breakevens.push(x0);
    if (y0 * y1 < 0 && x1 !== x0) {
      const t = y0 / (y0 - y1);
      breakevens.push(x0 + (x1 - x0) * t);
    }
  }
  if (Math.abs(pnls[pnls.length - 1]!) < 1e-6 && knots.length) breakevens.push(knots[knots.length - 1]!);
  const pnlHi = pnlAt(hi);
  if (hi > 0 && Math.abs(slopeAbove) > 1e-6 && pnlHi * slopeAbove < 0) breakevens.push(hi - pnlHi / slopeAbove);
  const unique = [...new Set(breakevens.map((b) => Math.round(b * 100) / 100))].sort((a, b) => a - b);
  const intrinsicNow = expiryValue(legs, spot);
  const roundedAbove = Math.round(slopeAbove);
  const roundedBelow = Math.round(slopeBelow);
  const lossAtZero = Math.max(0, Math.round(-pnlAt(0)));
  return {
    breakevens: unique.filter((b) => b > 0),
    maxLoss: roundedAbove < 0 ? "unbounded" : Math.max(0, Math.round(-worst)),
    maxLossUp: roundedAbove < 0 ? "unbounded" : Math.max(0, Math.round(-Math.min(pnlHi, 0))),
    maxLossDown: roundedBelow > 0 && lossAtZero > 0 ? lossAtZero : "flat",
    maxGain: roundedAbove > 0 ? "unbounded" : Math.round(best),
    slopeAbove: roundedAbove,
    slopeBelow: roundedBelow,
    intrinsic: Math.round(intrinsicNow),
    extrinsic: Math.round(debit - intrinsicNow),
  };
}

/** Cash-secured proxy for short puts: |qty| × strike × 100. Not a broker margin number. */
export function shortPutProxyDollars(legs: readonly ValueLeg[]): number {
  let sum = 0;
  for (const leg of legs) {
    if (leg.instrument === "stock" || leg.right !== "P" || !(leg.ratio < 0) || leg.strike == null) continue;
    const secured = optionMarginSecuredDollars(leg.ratio, leg.strike);
    if (secured != null) sum += secured;
  }
  return sum;
}

export type PackageBudget = {
  readonly cost: number | null;
  readonly putProxy: number;
  /** Naked short calls. Sizing waits until a call-side dollars-at-risk number is typed. */
  readonly callRiskRequired: boolean;
};

/**
 * One package cost for every capital basis.
 * A typed override replaces the cost, except on a naked short call, where it is the call side and the put proxy is added.
 * A short put uses the cash-secured proxy. A debit, including a synthetic long, uses the debit. A credit uses defined max loss.
 */
export function structurePackageCost(
  legs: readonly ValueLeg[],
  debit: number,
  risk: Pick<ExpiryRisk, "slopeAbove" | "slopeBelow" | "maxLoss">,
  override: number | null,
): PackageBudget {
  const putProxy = shortPutProxyDollars(legs);
  const callRiskRequired = risk.slopeAbove < 0;
  const losesAsSpotFalls = risk.slopeBelow > 0;
  const longBothWings = debit > 0 && risk.slopeAbove > 0 && losesAsSpotFalls;
  if (!callRiskRequired && override != null && override > 0) return { cost: override, putProxy, callRiskRequired };
  if (callRiskRequired) {
    if (override == null || !(override > 0)) return { cost: null, putProxy, callRiskRequired };
    return { cost: putProxy + override, putProxy, callRiskRequired };
  }
  if (putProxy > 0 && losesAsSpotFalls && !longBothWings) return { cost: putProxy, putProxy, callRiskRequired };
  if (debit > 0) return { cost: debit, putProxy, callRiskRequired };
  if (typeof risk.maxLoss === "number" && risk.maxLoss > 0) return { cost: risk.maxLoss, putProxy, callRiskRequired };
  return { cost: null, putProxy, callRiskRequired };
}

export function markAt(
  chain: OptionChain,
  expiry: IsoDate,
  legs: readonly PricedLeg[],
  assumptions: Assumptions,
  spot: number,
  date: IsoDate,
): number | null {
  let sum = 0;
  for (const leg of legs) {
    if (leg.instrument === "stock") {
      sum += leg.ratio * spot;
      continue;
    }
    if (leg.right == null || leg.strike == null) return null;
    const legExpiry = leg.expiry ?? expiry;
    const settled = calendarDaysBetween(date, legExpiry) <= 0;
    if (settled) {
      sum += intrinsic(leg.right, leg.strike, spot) * leg.ratio * 100;
      continue;
    }
    if (leg.iv == null) return null;
    const years = calendarDaysBetween(date, legExpiry) / 365;
    const px = bsmPrice({
      right: leg.right,
      spot,
      strike: leg.strike,
      years,
      rate: assumptions.rate,
      dividendYield: assumptions.dividendYield,
      vol: leg.iv,
    });
    sum += px * leg.ratio * 100;
  }
  return sum;
}

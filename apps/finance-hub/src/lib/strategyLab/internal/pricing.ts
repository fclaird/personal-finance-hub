import { bsmGreeks, bsmPrice, impliedVol } from "@/lib/options/blackScholes";
import {
  calendarDaysBetween,
  findQuote,
  type IsoDate,
  type OptionChain,
  type OptionRight,
} from "@/lib/optionChain/chain";

export type Assumptions = {
  readonly rate: number;
  readonly dividendYield: number;
  readonly ivSource: "mid" | "feed";
};

export type PricedLeg = {
  readonly right: OptionRight;
  readonly strike: number;
  readonly ratio: number;
  readonly bid: number | null;
  readonly ask: number | null;
  readonly mid: number | null;
  readonly iv: number | null;
  readonly feedIv: number | null;
  readonly ivFrom: "override" | "mid" | "feed" | null;
};

type LegIn = { readonly right: OptionRight; readonly strike: number; readonly ratio: number; readonly ivOverride: number | null };

function intrinsic(right: OptionRight, strike: number, spot: number): number {
  return right === "C" ? Math.max(spot - strike, 0) : Math.max(strike - spot, 0);
}

function yearsBetween(chain: OptionChain, expiry: IsoDate): number {
  return calendarDaysBetween(chain.tradeDate, expiry) / 365;
}

export function priceLegs(
  chain: OptionChain,
  expiry: IsoDate,
  legs: readonly LegIn[],
  assumptions: Assumptions,
): { readonly legs: PricedLeg[]; readonly ivFallback: boolean } | { readonly error: string } {
  const years = yearsBetween(chain, expiry);
  const out: PricedLeg[] = [];
  let ivFallback = false;
  for (const leg of legs) {
    const quote = findQuote(chain, expiry, leg.right, leg.strike);
    if (!quote) return { error: `No quote for the ${leg.strike} ${leg.right}.` };
    const fromMid = (): number | null => {
      if (quote.mid == null || !(years > 1e-8)) return null;
      const solved = impliedVol({
        right: leg.right,
        spot: chain.spot,
        strike: leg.strike,
        years,
        rate: assumptions.rate,
        dividendYield: assumptions.dividendYield,
        price: quote.mid,
      });
      return solved.ok ? solved.vol : null;
    };
    const fromFeed = () => quote.feedIv;
    let iv: number | null = null;
    let ivFrom: PricedLeg["ivFrom"] = null;
    if (leg.ivOverride != null && leg.ivOverride > 0) {
      iv = leg.ivOverride;
      ivFrom = "override";
    } else if (assumptions.ivSource === "mid") {
      iv = fromMid();
      ivFrom = iv != null ? "mid" : null;
      if (iv == null && fromFeed() != null) {
        iv = fromFeed();
        ivFrom = "feed";
        ivFallback = true;
      }
    } else {
      iv = fromFeed();
      ivFrom = iv != null ? "feed" : null;
      if (iv == null) {
        iv = fromMid();
        if (iv != null) {
          ivFrom = "mid";
          ivFallback = true;
        }
      }
    }
    out.push({
      right: leg.right,
      strike: leg.strike,
      ratio: leg.ratio,
      bid: quote.bid,
      ask: quote.ask,
      mid: quote.mid,
      iv,
      feedIv: quote.feedIv,
      ivFrom,
    });
  }
  return { legs: out, ivFallback };
}

export function netFromLegs(legs: readonly PricedLeg[], pick: "mid" | "natural"): number | null {
  let sum = 0;
  for (const leg of legs) {
    const px = pick === "mid" ? leg.mid : leg.ratio > 0 ? leg.ask : leg.bid;
    if (px == null) return null;
    sum += px * leg.ratio;
  }
  return sum;
}

export function entryDollars(netPerShare: number): number {
  return Math.round(netPerShare * 100);
}

export function packageGreeks(chain: OptionChain, expiry: IsoDate, legs: readonly PricedLeg[], assumptions: Assumptions) {
  const years = yearsBetween(chain, expiry);
  let delta = 0;
  let gamma = 0;
  let theta = 0;
  let vega = 0;
  for (const leg of legs) {
    if (leg.iv == null) return null;
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

/** Intrinsic package value in dollars, before subtracting the debit. */
export function expiryValue(legs: readonly { right: OptionRight; strike: number; ratio: number }[], spot: number): number {
  let sum = 0;
  for (const leg of legs) sum += intrinsic(leg.right, leg.strike, spot) * leg.ratio * 100;
  return sum;
}

export function expiryPnl(legs: readonly { right: OptionRight; strike: number; ratio: number }[], debit: number, spot: number): number {
  return expiryValue(legs, spot) - debit;
}

export type ExpiryRisk = {
  readonly breakevens: readonly number[];
  readonly maxLoss: number | "unbounded";
  readonly maxGain: number | "unbounded";
  readonly slopeAbove: number;
  readonly slopeBelow: number;
  readonly intrinsic: number;
  readonly extrinsic: number;
};

export function expiryRisk(
  legs: readonly { right: OptionRight; strike: number; ratio: number }[],
  debit: number,
  spot: number,
): ExpiryRisk {
  const strikes = [...new Set(legs.map((l) => l.strike))].sort((a, b) => a - b);
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
  const unique = [...new Set(breakevens.map((b) => Math.round(b * 100) / 100))].sort((a, b) => a - b);
  const intrinsicNow = expiryValue(legs, spot);
  return {
    breakevens: unique.filter((b) => b > 0),
    maxLoss: slopeAbove < -1e-6 ? "unbounded" : Math.max(0, Math.round(-worst)),
    maxGain: slopeAbove > 1e-6 ? "unbounded" : Math.round(best),
    slopeAbove: Math.round(slopeAbove),
    slopeBelow: Math.round(slopeBelow),
    intrinsic: Math.round(intrinsicNow),
    extrinsic: Math.round(debit - intrinsicNow),
  };
}

export function markAt(
  chain: OptionChain,
  expiry: IsoDate,
  legs: readonly PricedLeg[],
  assumptions: Assumptions,
  spot: number,
  date: IsoDate,
): number | null {
  const settled = calendarDaysBetween(date, expiry) <= 0;
  let sum = 0;
  for (const leg of legs) {
    if (settled) {
      sum += intrinsic(leg.right, leg.strike, spot) * leg.ratio * 100;
      continue;
    }
    if (leg.iv == null) return null;
    const years = calendarDaysBetween(date, expiry) / 365;
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

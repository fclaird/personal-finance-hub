import { impliedVol } from "@/lib/options/blackScholes";
import {
  calendarDaysBetween,
  findQuote,
  type IsoDate,
  type OptionChain,
  type OptionRight,
} from "@/lib/optionChain/chain";

/** Fixed lab model. One vol keeps every structure on the same surface. */
export const MODEL_RATE = 0.04;
export const MODEL_DIVIDEND_YIELD = 0;

/**
 * Average of solved at-the-money mids across loaded expiries.
 * Each expiry contributes the call and the put at the strike closest to spot
 * (the lower strike wins a tie). A per-structure 50-delta vol would give two
 * expiries two different vols and bend the comparison.
 */
export function underlyingModelIv(chain: OptionChain): number | null {
  const vols: number[] = [];
  for (const expiry of chain.expiries) {
    const strike = nearestToSpot(
      expiry.strikes.map((row) => row.strike),
      chain.spot,
    );
    if (strike == null) continue;
    const years = calendarDaysBetween(chain.tradeDate, expiry.date) / 365;
    for (const right of ["C", "P"] as const) {
      const vol = solvedMidVol(chain, expiry.date, right, strike, years);
      if (vol != null) vols.push(vol);
    }
  }
  if (vols.length === 0) return null;
  return vols.reduce((sum, vol) => sum + vol, 0) / vols.length;
}

export function modelAssumptionLabel(iv: number | null): string {
  if (iv == null) return "IV unavailable, rate 4%, no dividends: model assumptions";
  return `IV ${Math.round(iv * 100)}%, rate 4%, no dividends: model assumptions`;
}

function nearestToSpot(strikes: readonly number[], spot: number): number | null {
  let best: number | null = null;
  let bestDist = Infinity;
  for (const strike of strikes) {
    const dist = Math.abs(strike - spot);
    if (best == null || dist < bestDist - 1e-9 || (Math.abs(dist - bestDist) <= 1e-9 && strike < best)) {
      best = strike;
      bestDist = dist;
    }
  }
  return best;
}

function solvedMidVol(
  chain: OptionChain,
  expiry: IsoDate,
  right: OptionRight,
  strike: number,
  years: number,
): number | null {
  const quote = findQuote(chain, expiry, right, strike);
  if (quote?.mid == null) return null;
  const solved = impliedVol({
    right,
    spot: chain.spot,
    strike,
    years,
    rate: MODEL_RATE,
    dividendYield: MODEL_DIVIDEND_YIELD,
    price: quote.mid,
  });
  return solved.ok ? solved.vol : null;
}

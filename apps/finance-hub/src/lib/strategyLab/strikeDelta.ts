import { bsmGreeks, impliedVol } from "@/lib/options/blackScholes";
import {
  calendarDaysBetween,
  findQuote,
  listedStrikes,
  type IsoDate,
  type OptionChain,
  type OptionRight,
} from "@/lib/optionChain/chain";

export type DeltaAssumptions = { readonly rate: number; readonly dividendYield: number };

export type StrikeDelta = { readonly strike: number; readonly delta: number | null };

/**
 * Model delta at this expiry. IV is solved from the mid. Call delta is positive;
 * put delta is negative. Null when the mid will not solve. Approximate.
 */
export type ModelStrike = { readonly iv: number; readonly delta: number };

/** IV solved from the mid, and the matching model delta. Null when the mid will not solve. */
export function modelStrike(
  chain: OptionChain,
  expiry: IsoDate,
  right: OptionRight,
  strike: number,
  assumptions: DeltaAssumptions,
): ModelStrike | null {
  const quote = findQuote(chain, expiry, right, strike);
  if (!quote || quote.mid == null) return null;
  const years = calendarDaysBetween(chain.tradeDate, expiry) / 365;
  if (!(years > 1e-8)) return null;
  const solved = impliedVol({
    right,
    spot: chain.spot,
    strike,
    years,
    rate: assumptions.rate,
    dividendYield: assumptions.dividendYield,
    price: quote.mid,
  });
  if (!solved.ok) return null;
  return {
    iv: solved.vol,
    delta: bsmGreeks({
      right,
      spot: chain.spot,
      strike,
      years,
      rate: assumptions.rate,
      dividendYield: assumptions.dividendYield,
      vol: solved.vol,
    }).delta,
  };
}

export function modelStrikeDelta(
  chain: OptionChain,
  expiry: IsoDate,
  right: OptionRight,
  strike: number,
  assumptions: DeltaAssumptions,
): number | null {
  return modelStrike(chain, expiry, right, strike, assumptions)?.delta ?? null;
}

export function strikeDeltas(
  chain: OptionChain,
  expiry: IsoDate,
  right: OptionRight,
  assumptions: DeltaAssumptions,
): readonly StrikeDelta[] {
  return listedStrikes(chain, expiry, right).map((strike) => ({
    strike,
    delta: modelStrikeDelta(chain, expiry, right, strike, assumptions),
  }));
}

/** Closest listed |delta| to `target`. Ties break toward the lower or higher strike. */
export function nearestDeltaStrike(
  rows: readonly StrikeDelta[],
  target: number,
  tie: "lower" | "higher" = "lower",
): number | null {
  let best: number | null = null;
  let bestDist = Infinity;
  for (const row of rows) {
    if (row.delta == null) continue;
    const dist = Math.abs(Math.abs(row.delta) - target);
    if (best == null || dist < bestDist - 1e-6 || (Math.abs(dist - bestDist) <= 1e-6 && (tie === "lower" ? row.strike < best : row.strike > best))) {
      best = row.strike;
      bestDist = dist;
    }
  }
  return best;
}

export function deltaHighlights(rows: readonly StrikeDelta[]): { readonly seventyFive: number | null; readonly fifty: number | null } {
  return {
    seventyFive: nearestDeltaStrike(rows, 0.75, "lower"),
    fifty: nearestDeltaStrike(rows, 0.5, "lower"),
  };
}

/** ".78", "-.22", "1.05". */
export function formatModelDelta(delta: number): string {
  if (!Number.isFinite(delta)) return "—";
  const digits = Math.abs(delta).toFixed(2);
  const body = digits.startsWith("0") ? digits.slice(1) : digits;
  return delta < 0 ? `-${body}` : body;
}

export function strikeChoiceLabel(strike: number, delta: number | null, highlight: "75" | "50" | "both" | null): string {
  const deltaText = delta == null ? "—" : formatModelDelta(delta);
  const mark = highlight === "both" ? "  · .75 · .50" : highlight === "75" ? "  · .75" : highlight === "50" ? "  · .50" : "";
  return `${strike}  (Δ ${deltaText})${mark}`;
}

export function highlightFor(strike: number, marks: { readonly seventyFive: number | null; readonly fifty: number | null }): "75" | "50" | "both" | null {
  const seventyFive = strike === marks.seventyFive;
  const fifty = strike === marks.fifty;
  if (seventyFive && fifty) return "both";
  if (seventyFive) return "75";
  if (fifty) return "50";
  return null;
}

export type DeltaSummary = {
  readonly net: number | null;
  readonly ratio: number | null;
  readonly legs: readonly { readonly strike: number; readonly right: OptionRight; readonly ratio: number; readonly delta: number | null }[];
};

/** Package net delta (×100) and long/short |delta| ratio, from the same mid model as the dropdown. */
export function structureDeltaSummary(
  legs: readonly { readonly right: OptionRight; readonly strike: number; readonly ratio: number }[],
  deltaFor: (right: OptionRight, strike: number) => number | null,
): DeltaSummary {
  const priced = legs.map((leg) => ({ ...leg, delta: deltaFor(leg.right, leg.strike) }));
  if (priced.length === 0 || priced.some((leg) => leg.delta == null)) return { net: null, ratio: null, legs: priced };
  const net = priced.reduce((sum, leg) => sum + (leg.delta as number) * leg.ratio * 100, 0);
  const long = priced.filter((leg) => leg.ratio > 0).reduce((sum, leg) => sum + Math.abs((leg.delta as number) * leg.ratio), 0);
  const short = priced.filter((leg) => leg.ratio < 0).reduce((sum, leg) => sum + Math.abs((leg.delta as number) * leg.ratio), 0);
  return { net, ratio: short > 0 ? long / short : null, legs: priced };
}

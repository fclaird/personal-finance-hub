import type { Position, Snapshot } from "@/lib/fortress/types";

export type Known = { readonly status: "known"; readonly value: number } | { readonly status: "unknown"; readonly reason: string };

export type UnderlyingExposure = {
  readonly underlying: string;
  readonly shares: number;
  readonly deltaShares: Known;
  readonly deltaDollars: Known;
  readonly grossShortPutStrikeCash: number;
  readonly grossShortCallShares: number;
};

function unknown(reason: string): Known {
  return { status: "unknown", reason };
}

/** S × (signed shares + Σ signed contracts × multiplier × delta). A missing delta stays unknown. */
export function exposures(snapshot: Snapshot, spots: Readonly<Record<string, number>>): UnderlyingExposure[] {
  const names = new Set<string>();
  for (const position of snapshot.positions) names.add(position.kind === "option" ? position.contract.underlying : position.symbol);
  return [...names].sort().map((underlying) => one(snapshot.positions, underlying, spots[underlying]));
}

function one(positions: readonly Position[], underlying: string, spot: number | undefined): UnderlyingExposure {
  let shares = 0;
  let contractShares = 0;
  let missing = false;
  let grossShortPutStrikeCash = 0;
  let grossShortCallShares = 0;
  for (const position of positions) {
    if (position.kind !== "option") {
      if (position.symbol === underlying) shares += position.quantity;
      continue;
    }
    if (position.contract.underlying !== underlying) continue;
    if (position.delta == null) missing = true;
    else contractShares += position.quantity * position.contract.multiplier * position.delta;
    if (position.quantity < 0 && position.contract.right === "P") {
      grossShortPutStrikeCash += Math.abs(position.quantity) * position.contract.multiplier * position.contract.strike;
    }
    if (position.quantity < 0 && position.contract.right === "C") {
      grossShortCallShares += Math.abs(position.quantity) * position.contract.deliverableShares;
    }
  }
  const deltaShares: Known = missing ? unknown(`Delta is missing on ${underlying}. It is not treated as zero.`) : { status: "known", value: shares + contractShares };
  const deltaDollars: Known =
    deltaShares.status === "unknown"
      ? unknown(deltaShares.reason)
      : !(spot != null && spot > 0)
        ? unknown(`Spot is missing for ${underlying}.`)
        : { status: "known", value: spot * deltaShares.value };
  return { underlying, shares, deltaShares, deltaDollars, grossShortPutStrikeCash, grossShortCallShares };
}

/** Inverse HHI of absolute net delta dollars. Not a count of independent bets. */
export function nWeight(rows: readonly UnderlyingExposure[]): Known {
  const weights: number[] = [];
  for (const row of rows) {
    if (row.deltaDollars.status === "unknown") return unknown(row.deltaDollars.reason);
    weights.push(Math.abs(row.deltaDollars.value));
  }
  const total = weights.reduce((sum, value) => sum + value, 0);
  if (!(total > 0)) return unknown("Absolute delta dollars sum to zero, so concentration has no denominator.");
  const hhi = weights.reduce((sum, value) => sum + (value / total) ** 2, 0);
  if (!(hhi > 0)) return unknown("HHI is zero.");
  return { status: "known", value: 1 / hhi };
}

export function signedNavWeight(deltaDollars: Known, nav: number): Known {
  if (deltaDollars.status === "unknown") return deltaDollars;
  if (!(nav > 0)) return unknown("NAV is not positive, so a signed weight is undefined.");
  return { status: "known", value: deltaDollars.value / nav };
}

/** Local gamma P&L. This is not a substitute for the full reprice. */
export function gammaPnl(legs: readonly { quantity: number; multiplier: number; gamma: number | null; dSpot: number }[]): Known {
  let total = 0;
  for (const leg of legs) {
    if (leg.gamma == null) return unknown("Gamma is missing, so gamma P&L is unknown.");
    total += 0.5 * leg.quantity * leg.multiplier * leg.gamma * leg.dSpot * leg.dSpot;
  }
  return { status: "known", value: total };
}

import { netAssetValue } from "@/lib/fortress/ledger";
import type { OptionPosition, Snapshot } from "@/lib/fortress/types";

/**
 * Strategy-based option margin for listed single-name equity options.
 *
 * Sources, read 2026-11-15:
 * - FINRA Rule 4210(f)(2)(E): listed equity options carried short use 20% of the
 *   underlying value, reduced by the out-of-the-money amount, and not below 10%.
 *   For a short put the 10% floor is on the aggregate exercise price.
 *   https://www.finra.org/rules-guidance/rulebooks/finra-rules/4210
 * - CBOE strategy-based margin table, "Short Put or Short Call" equity row, and the
 *   covered-call and spread rows.
 *   https://www.cboe.com/us/options/strategy_based_margin
 *
 * This is not a Schwab house margin call. Schwab can require more. The broad-index
 * 15% schedule is not used, because the book does not classify an underlying as a
 * broad index. A short strangle is charged the greater of the two uncovered add-ons,
 * which is the CBOE offset. A credit is not subtracted from a spread's strike width,
 * so a spread requirement is the full width.
 */
export const OPTION_MARGIN_SOURCE = "FINRA Rule 4210(f)(2)(E) and the CBOE strategy-based margin table";
export const OPTION_MARGIN_SOURCE_DATE = "2026-11-15";

export type MarginLine = {
  readonly label: string;
  readonly amount: number | null;
  readonly rule: string;
};

export type RegTMargin = {
  readonly status: "known" | "unknown";
  readonly reason: string | null;
  readonly equity: number | null;
  readonly requirement: number | null;
  readonly excess: number | null;
  readonly source: string;
  readonly sourceDate: string;
  readonly lines: readonly MarginLine[];
};

type OpenLeg = OptionPosition & { quantity: number };

export function regTMargin(snapshot: Snapshot, spots: Readonly<Record<string, number>>, maintenanceLong: number, houseHike = 0): RegTMargin {
  const blank = (reason: string): RegTMargin => ({
    status: "unknown",
    reason,
    equity: null,
    requirement: null,
    excess: null,
    source: OPTION_MARGIN_SOURCE,
    sourceDate: OPTION_MARGIN_SOURCE_DATE,
    lines: [],
  });
  const maintenance = maintenanceLong + houseHike;
  if (!(maintenance >= 0) || !(maintenance < 1)) return blank("The stock maintenance rate is outside [0, 1).");
  const nav = netAssetValue(snapshot);
  if (nav.status !== "known") return blank(nav.reason);
  const percent = 0.2 + houseHike;
  const floor = 0.1 + houseHike;
  if (!(percent > 0) || !(floor > 0)) return blank("The option percentage is not positive.");

  const lines: MarginLine[] = [];
  let requirement = 0;
  const byUnderlying = new Map<string, { shares: number; options: OptionPosition[] }>();
  const touch = (symbol: string) => {
    const key = symbol.trim().toUpperCase();
    const row = byUnderlying.get(key) ?? { shares: 0, options: [] };
    byUnderlying.set(key, row);
    return row;
  };
  for (const position of snapshot.positions) {
    if (position.kind === "option") touch(position.contract.underlying).options.push(position);
    else touch(position.symbol).shares += position.quantity;
  }

  for (const [symbol, group] of byUnderlying) {
    const spot = spots[symbol];
    const shorts = group.options.filter((position) => position.quantity < 0);
    if (shorts.length > 0 && !(spot > 0)) return blank(`${symbol} has a short option and no positive spot.`);
    if (group.options.some((position) => position.mark == null || !Number.isFinite(position.mark) || position.mark < 0)) {
      return blank(`${symbol} has an option without a current premium.`);
    }
    if ((group.shares > 0 || group.shares < 0) && !(spot > 0)) return blank(`${symbol} has shares and no positive spot.`);

    const legs: OpenLeg[] = group.options.map((position) => ({ ...position, quantity: position.quantity }));
    const paired = pairVerticals(legs);
    for (const spread of paired) {
      requirement += spread.amount;
      lines.push({ label: `${symbol} ${spread.label}`, amount: spread.amount, rule: "CBOE defined-risk spread: full strike width. The credit is not subtracted." });
    }

    const calls = legs.filter((leg) => leg.contract.right === "C" && leg.quantity < 0);
    const puts = legs.filter((leg) => leg.contract.right === "P" && leg.quantity < 0);
    let coverable = Math.max(0, group.shares);
    let callAddon = 0;
    for (const call of calls) {
      const deliverable = call.contract.deliverableShares;
      const coverContracts = deliverable > 0 ? Math.min(Math.abs(call.quantity), coverable / deliverable) : 0;
      coverable -= coverContracts * deliverable;
      const uncovered = Math.abs(call.quantity) - coverContracts;
      if (coverContracts > 0) lines.push({ label: `${symbol} covered call`, amount: 0, rule: "CBOE covered call: no add-on on the covered contracts." });
      if (uncovered > 0) {
        const addon = uncoveredCall(call, uncovered, spot!, percent, floor);
        callAddon += addon;
      }
    }
    let putAddon = 0;
    for (const put of puts) {
      putAddon += uncoveredPut(put, Math.abs(put.quantity), spot!, percent, floor);
    }
    const shortAddon = callAddon > 0 && putAddon > 0 ? Math.max(callAddon, putAddon) : callAddon + putAddon;
    if (shortAddon > 0) {
      requirement += shortAddon;
      const rule = callAddon > 0 && putAddon > 0
        ? "CBOE short strangle: the greater uncovered add-on. FINRA 4210 equity 20% with a 10% floor."
        : "FINRA 4210(f)(2)(E) uncovered equity option, 20% with a 10% floor.";
      lines.push({ label: `${symbol} short option add-on`, amount: shortAddon, rule });
    }

    for (const leg of legs) {
      if (leg.quantity <= 0) continue;
      const premium = leg.quantity * (leg.mark ?? 0) * leg.contract.multiplier;
      requirement += premium;
      lines.push({ label: `${symbol} long ${leg.contract.right}`, amount: premium, rule: "Long listed option: 100% of the current premium. No loan value." });
    }

    if (group.shares > 0) {
      const stock = maintenance * group.shares * spot!;
      requirement += stock;
      lines.push({ label: `${symbol} long stock`, amount: stock, rule: `Stock maintenance ${(maintenance * 100).toFixed(1)}%. FINRA 4210(c)(1) is 25%. The book rate is used when it is higher.` });
    } else if (group.shares < 0) {
      const stock = shortStockRequirement(group.shares, spot!, houseHike);
      requirement += stock;
      lines.push({ label: `${symbol} short stock`, amount: stock, rule: "FINRA 4210(c)(2)–(3): the greater of the percent and the per-share minimum." });
    }
  }

  const excess = nav.value - requirement;
  return {
    status: "known",
    reason: null,
    equity: nav.value,
    requirement,
    excess,
    source: OPTION_MARGIN_SOURCE,
    sourceDate: OPTION_MARGIN_SOURCE_DATE,
    lines,
  };
}

function pairVerticals(legs: OpenLeg[]): { label: string; amount: number }[] {
  const spreads: { label: string; amount: number }[] = [];
  for (const leg of legs) {
    if (leg.quantity <= 0) continue;
    const other = legs.find((candidate) =>
      candidate.quantity < 0 &&
      candidate.contract.right === leg.contract.right &&
      candidate.contract.expiry === leg.contract.expiry &&
      candidate.contract.multiplier === leg.contract.multiplier &&
      candidate.contract.deliverableShares === leg.contract.deliverableShares,
    );
    if (!other) continue;
    const contracts = Math.min(leg.quantity, Math.abs(other.quantity));
    const width = Math.abs(leg.contract.strike - other.contract.strike) * leg.contract.deliverableShares * contracts;
    leg.quantity -= contracts;
    other.quantity += contracts;
    spreads.push({ label: `${leg.contract.right} vertical`, amount: width });
  }
  return spreads;
}

function uncoveredCall(leg: OpenLeg, contracts: number, spot: number, percent: number, floor: number): number {
  const shares = contracts * leg.contract.deliverableShares;
  const otm = Math.max(0, leg.contract.strike - spot) * shares;
  const base = percent * spot * shares - otm;
  return Math.max(base, floor * spot * shares);
}

function uncoveredPut(leg: OpenLeg, contracts: number, spot: number, percent: number, floor: number): number {
  const shares = contracts * leg.contract.deliverableShares;
  const otm = Math.max(0, spot - leg.contract.strike) * shares;
  const base = percent * spot * shares - otm;
  return Math.max(base, floor * leg.contract.strike * shares);
}

function shortStockRequirement(shares: number, spot: number, houseHike: number): number {
  const absShares = Math.abs(shares);
  const market = absShares * spot;
  if (spot < 5) return Math.max((1 + houseHike) * market, 2.5 * absShares);
  return Math.max((0.3 + houseHike) * market, 5 * absShares);
}

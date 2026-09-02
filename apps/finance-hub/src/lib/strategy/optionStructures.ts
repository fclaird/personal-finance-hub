import { daysBetween, type InstructionKind } from "@/lib/strategy/optionParse";

export type OptionLegView = {
  right: "C" | "P" | null;
  strike: number | null;
  expiration: string | null;
  instruction: InstructionKind;
  opening: boolean;
  quantity: number | null;
};

export type OptionStructureKind =
  | "short-strangle"
  | "long-strangle"
  | "butterfly"
  | "spread"
  | "single";

function absQty(q: number | null | undefined): number {
  if (q == null || !Number.isFinite(q)) return 1;
  return Math.abs(q);
}

function signedQty(leg: OptionLegView): number {
  const q = absQty(leg.quantity);
  if (leg.instruction === "sell_open" || leg.instruction === "sell_close") return -q;
  if (leg.instruction === "buy_open" || leg.instruction === "buy_close") return q;
  return leg.opening ? q : -q;
}

function sameOrNearExpiration(a: string | null, b: string | null, maxDays = 7): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const d = daysBetween(a, b);
  return d != null && d <= maxDays;
}

/** Classic 1-2-1 butterfly (same right) or iron butterfly (put+call body + wings). */
export function isButterflyStructure(legs: OptionLegView[]): boolean {
  const optionLegs = legs.filter((l) => l.right && l.strike != null);
  if (optionLegs.length < 3) return false;

  const expirations = optionLegs.map((l) => l.expiration).filter((x): x is string => !!x);
  if (expirations.length === 0) return false;
  const exp0 = expirations[0]!;
  if (!expirations.every((e) => sameOrNearExpiration(e, exp0, 0))) return false;

  const strikes = [...new Set(optionLegs.map((l) => l.strike!))].sort((a, b) => a - b);
  if (strikes.length < 3 || strikes.length > 3) {
    // Iron condor uses 4 strikes — treat as spread, not butterfly.
    return false;
  }

  const byStrike = new Map<number, number>();
  for (const leg of optionLegs) {
    const k = leg.strike!;
    byStrike.set(k, (byStrike.get(k) ?? 0) + signedQty(leg));
  }
  const low = byStrike.get(strikes[0]!) ?? 0;
  const mid = byStrike.get(strikes[1]!) ?? 0;
  const high = byStrike.get(strikes[2]!) ?? 0;
  if (low === 0 || mid === 0 || high === 0) return false;
  // Wings same sign, body opposite and ~2×.
  if (Math.sign(low) !== Math.sign(high)) return false;
  if (Math.sign(mid) === Math.sign(low)) return false;
  const wing = (Math.abs(low) + Math.abs(high)) / 2;
  return Math.abs(Math.abs(mid) - 2 * wing) <= 0.51 * Math.max(1, wing);
}

export function detectOptionStructure(legs: OptionLegView[]): OptionStructureKind {
  const optionLegs = legs.filter((l) => l.right);
  if (optionLegs.length <= 1) return "single";
  if (isButterflyStructure(optionLegs)) return "butterfly";

  const opening = optionLegs.filter((l) => l.opening);
  const pool = opening.length >= 2 ? opening : optionLegs;
  const puts = pool.filter((l) => l.right === "P");
  const calls = pool.filter((l) => l.right === "C");
  if (puts.length >= 1 && calls.length >= 1) {
    const p = puts[0]!;
    const c = calls[0]!;
    const nearExp = sameOrNearExpiration(p.expiration, c.expiration, 7);
    const differentStrike =
      p.strike != null && c.strike != null ? p.strike !== c.strike : true;
    const bothShort = isShortPremiumInstructionSet(puts) && isShortPremiumInstructionSet(calls);
    const bothLong = isLongPremiumInstructionSet(puts) && isLongPremiumInstructionSet(calls);
    if (nearExp && differentStrike && bothShort) return "short-strangle";
    if (nearExp && bothLong) return "long-strangle";
    // Same-strike short straddle is still a short-premium two-leg book.
    if (nearExp && bothShort) return "short-strangle";
  }

  return "spread";
}

function isShortPremiumInstructionSet(legs: OptionLegView[]): boolean {
  return legs.every((l) => l.instruction === "sell_open" || l.instruction === "unknown");
}

function isLongPremiumInstructionSet(legs: OptionLegView[]): boolean {
  return legs.every((l) => l.instruction === "buy_open" || l.instruction === "unknown");
}

export function structureTitle(kind: OptionStructureKind, underlying: string): string {
  switch (kind) {
    case "short-strangle":
      return `${underlying} short strangle`;
    case "long-strangle":
      return `${underlying} long strangle`;
    case "butterfly":
      return `${underlying} butterfly`;
    case "spread":
      return `${underlying} spread`;
    default:
      return `${underlying} option`;
  }
}

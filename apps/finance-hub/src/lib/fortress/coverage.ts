import type { MarketState, OptionPosition, Snapshot } from "@/lib/fortress/types";

/**
 * Supported set: equity and ETF, plus single-name American or European calls and puts
 * with an explicit multiplier, deliverable, and physical or cash settlement.
 * Not supported: exotics, adjusted contracts without deliverable metadata, broker portfolio margin,
 * short-option margin, and a share-count import that omitted cash, debt, or contracts.
 */
export function contractGap(position: OptionPosition): string | null {
  const contract = position.contract;
  if (!(contract.multiplier > 0)) return `${position.id} is missing a contract multiplier.`;
  if (!(contract.deliverableShares > 0)) return `${position.id} is missing a deliverable share count.`;
  if (contract.style !== "american" && contract.style !== "european") return `${position.id} is missing an exercise style.`;
  if (contract.settlement !== "physical" && contract.settlement !== "cash") return `${position.id} is missing a settlement kind.`;
  if (contract.exotic) return `${position.id} is exotic and blocks a complete verdict.`;
  if (contract.adjusted && contract.adjustedMetadata !== "complete") return `${position.id} is adjusted without complete deliverable metadata.`;
  return null;
}

export function bookGap(snapshot: Snapshot, market: MarketState): string | null {
  const completeness = snapshot.completeness;
  if (completeness.cash === "missing") return "Cash was not recorded. A share-count copy is not the actual book.";
  if (completeness.debt === "missing") return "Debt was not recorded. A share-count copy is not the actual book.";
  if (completeness.contracts !== "recorded") return "Option contracts were not imported. Long-stock maintenance is not applied to this copy.";
  if (completeness.quotes !== "recorded") return "The quote vintage is stale or missing, so the comparison is incomplete.";
  if (completeness.dividends === "missing") return "Dividend treatment was not recorded.";
  if (completeness.dividends === "explicit-zero" && snapshot.dividends.length > 0) {
    return "The book says there is no dividend, but a cash dividend is listed.";
  }
  for (const [symbol, yieldRate] of Object.entries(market.dividendYield)) {
    if (yieldRate > 0 && snapshot.dividends.some((dividend) => dividend.underlying === symbol)) {
      return `${symbol} would count a cash dividend and a dividend yield. One of them has to be zero.`;
    }
  }
  for (const position of snapshot.positions) {
    if (position.kind === "option") {
      const gap = contractGap(position);
      if (gap) return gap;
    }
  }
  return null;
}

export type MarginCoverage = { readonly kind: "long-stock" } | { readonly kind: "unknown"; readonly reason: string };

/** Long-stock maintenance applies only to a book with no option contracts. */
export function marginCoverage(snapshot: Snapshot): MarginCoverage {
  if (snapshot.positions.some((position) => position.kind === "option")) {
    const short = snapshot.positions.some((position) => position.kind === "option" && position.quantity < 0);
    return {
      kind: "unknown",
      reason: short
        ? "Short-option margin is unknown. The long-stock formula is not used."
        : "Option contracts are in the book. The long-stock maintenance formula is not used.",
    };
  }
  if (snapshot.completeness.contracts !== "recorded" || snapshot.completeness.cash === "missing" || snapshot.completeness.debt === "missing") {
    return { kind: "unknown", reason: "Cash, debt, or contract metadata is missing, so maintenance is unknown." };
  }
  return { kind: "long-stock" };
}

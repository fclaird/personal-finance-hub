import type { StrategyTabSlug } from "@/lib/strategy/strategyCategories";

/** Product face of the short-premium book — not the raw All-fills dump. */
export const DEFAULT_STRATEGY_HREF = "/strategies/situations";

export const STRATEGY_TAB_GROUPS: { label: string | null; slugs: StrategyTabSlug[] }[] = [
  { label: null, slugs: ["situations", "realized", "all"] },
  { label: "Structures", slugs: ["short-strangles", "butterflies", "spreads"] },
  { label: "Short premium", slugs: ["options-sales", "naked-calls", "covered-calls", "earnings"] },
  { label: "Long", slugs: ["leaps", "long-calls", "long-puts"] },
  { label: null, slugs: ["uncategorized"] },
];

export const SECONDARY_STRATEGY_SLUGS: StrategyTabSlug[] = ["leaps", "long-calls", "long-puts", "uncategorized"];

export function isSecondaryStrategySlug(slug: StrategyTabSlug): boolean {
  return SECONDARY_STRATEGY_SLUGS.includes(slug);
}

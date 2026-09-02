import type { StrategyTabSlug } from "@/lib/strategy/strategyCategories";

export const STRATEGY_TAB_GROUPS: { label: string | null; slugs: StrategyTabSlug[] }[] = [
  { label: null, slugs: ["situations", "all"] },
  { label: "Structures", slugs: ["short-strangles", "butterflies", "spreads"] },
  { label: "Short premium", slugs: ["options-sales", "naked-calls", "covered-calls", "earnings"] },
  { label: "Long", slugs: ["leaps", "long-calls", "long-puts"] },
  { label: null, slugs: ["uncategorized"] },
];

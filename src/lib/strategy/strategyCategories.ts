export const STRATEGY_SLUGS = [
  "buy-and-hold",
  "covered-calls",
  "earnings",
  "options-sales",
  "leaps",
  "spreads",
  "uncategorized",
] as const;

export type StrategySlug = (typeof STRATEGY_SLUGS)[number];

/** Routes and API only; not a stored classification bucket. Buy-and-hold is classified in DB but has no tab. */
export type StrategyTabSlug = "all" | Exclude<StrategySlug, "buy-and-hold">;

export const STRATEGY_TAB_META: { slug: StrategyTabSlug; label: string }[] = [
  { slug: "all", label: "All" },
  { slug: "covered-calls", label: "Covered Calls" },
  { slug: "earnings", label: "Earnings" },
  { slug: "options-sales", label: "Options Sales" },
  { slug: "leaps", label: "LEAPs" },
  { slug: "spreads", label: "Spreads" },
  { slug: "uncategorized", label: "Uncategorized" },
];

export function isStrategySlug(s: string): s is StrategySlug {
  return (STRATEGY_SLUGS as readonly string[]).includes(s);
}

export function isStrategyTabSlug(s: string): s is StrategyTabSlug {
  return s === "all" || (isStrategySlug(s) && s !== "buy-and-hold");
}

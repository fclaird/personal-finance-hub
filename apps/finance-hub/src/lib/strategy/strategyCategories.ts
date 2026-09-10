export const STRATEGY_SLUGS = [
  "buy-and-hold",
  "covered-calls",
  "naked-calls",
  "earnings",
  "options-sales",
  "short-strangles",
  "butterflies",
  "leaps",
  "long-calls",
  "long-puts",
  "spreads",
  "uncategorized",
] as const;

export type StrategySlug = (typeof STRATEGY_SLUGS)[number];

/** Routes and API only; not a stored classification bucket. Buy-and-hold is classified in DB but has no tab. */
export type StrategyTabSlug = "all" | "situations" | "realized" | Exclude<StrategySlug, "buy-and-hold">;

export const STRATEGY_TAB_META: { slug: StrategyTabSlug; label: string }[] = [
  { slug: "all", label: "All" },
  { slug: "situations", label: "Situations" },
  { slug: "realized", label: "Realized G/L" },
  { slug: "covered-calls", label: "Covered Calls" },
  { slug: "naked-calls", label: "Naked Calls" },
  { slug: "earnings", label: "Earnings" },
  { slug: "options-sales", label: "Short Puts" },
  { slug: "short-strangles", label: "Strangles" },
  { slug: "butterflies", label: "Butterflies" },
  { slug: "leaps", label: "LEAPs" },
  { slug: "long-calls", label: "Long Calls" },
  { slug: "long-puts", label: "Long Puts" },
  { slug: "spreads", label: "Spreads" },
  { slug: "uncategorized", label: "Uncategorized" },
];

/** Stored labels that may be stale after the taxonomy split; dual-read these at query time. */
export const LEGACY_STRATEGY_SLUGS = ["covered-calls", "options-sales", "spreads"] as const;

export function isStrategySlug(s: string): s is StrategySlug {
  return (STRATEGY_SLUGS as readonly string[]).includes(s);
}

export function isStrategyTabSlug(s: string): s is StrategyTabSlug {
  return s === "all" || s === "situations" || s === "realized" || (isStrategySlug(s) && s !== "buy-and-hold");
}

export function strategyLabel(slug: string | null | undefined): string {
  if (slug == null || slug === "") return "—";
  const meta = STRATEGY_TAB_META.find((t) => t.slug === slug);
  if (meta) return meta.label;
  return slug.replace(/-/g, " ");
}

/**
 * Categories that may still hold pre-split rows. The API dual-reads these and
 * applies live classification so historical labels are not silently wrong.
 */
export function dualReadSourceCategories(tab: StrategyTabSlug): string[] | null {
  switch (tab) {
    case "all":
    case "situations":
    case "realized":
      return null;
    case "naked-calls":
      return ["naked-calls", "covered-calls"];
    case "covered-calls":
      return ["covered-calls", "naked-calls"];
    case "long-calls":
      return ["long-calls", "options-sales"];
    case "long-puts":
      return ["long-puts", "options-sales"];
    case "short-strangles":
      return ["short-strangles", "spreads"];
    case "butterflies":
      return ["butterflies", "spreads"];
    case "options-sales":
      return ["options-sales", "long-calls", "long-puts"];
    default:
      return [tab];
  }
}

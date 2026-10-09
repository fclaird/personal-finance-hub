/**
 * Strategy Lab colors for a near-black canvas (#09090b / #0a0a0a).
 * Lines are bright on purpose. Do not swap these for the darker Tailwind 600s.
 */
export const LAB_PALETTE = {
  series: ["#4ade80", "#22d3ee", "#fbbf24", "#e879f9"] as const,
  stock: "#d4d4d8",
  spot: "#fafafa",
  strike: "#d8b4fe",
  whatIf: "#fb7185",
  zero: "#e4e4e7",
  grid: "#71717a",
  axis: "#e4e4e7",
  axisLine: "#a1a1aa",
  dotStroke: "#09090b",
  zoneOpacity: 0.32,
  line: 3,
  stockLine: 2.5,
} as const;

/** Inputs and selects. Zinc-400 borders clear WCAG 3:1 against zinc-950; text is zinc-50. */
export const labControl =
  "rounded border border-zinc-400 bg-white text-zinc-950 dark:border-zinc-400 dark:bg-zinc-900 dark:text-zinc-50 dark:[color-scheme:dark]";

export const labLabel = "text-xs font-medium text-zinc-700 dark:text-zinc-300";

export const labCard = "rounded-xl border border-zinc-300 bg-white dark:border-zinc-500 dark:bg-zinc-950";

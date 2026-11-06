/**
 * Strategy Lab colors for a near-black canvas (#09090b / #0a0a0a).
 * Lines are bright on purpose. Do not swap these for the darker Tailwind 600s.
 */
export const LAB_PALETTE = {
  series: [
    "#4ade80",
    "#22d3ee",
    "#fbbf24",
    "#e879f9",
    "#60a5fa",
    "#fb7185",
    "#a3e635",
    "#fb923c",
    "#818cf8",
    "#2dd4bf",
    "#f9a8d4",
    "#fde047",
  ] as const,
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

const slotColor = new Map<number, string>();

function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

/**
 * Bright color for a structure slot. Slots past the fixed list keep going around the wheel,
 * and a collision with an earlier slot is nudged until the color is new.
 */
export function seriesColor(slot: number): string {
  const index = Number.isInteger(slot) && slot >= 0 ? slot : 0;
  const cached = slotColor.get(index);
  if (cached) return cached;
  const used = new Set<string>();
  for (let i = 0; i <= index; i++) {
    const known = slotColor.get(i);
    if (known) {
      used.add(known.toLowerCase());
      continue;
    }
    let hue = (i * 137.508) % 360;
    let color = i < LAB_PALETTE.series.length ? LAB_PALETTE.series[i]! : hslToHex(hue, 0.9, 0.64);
    let nudge = 0;
    while (used.has(color.toLowerCase()) && nudge < 64) {
      nudge += 1;
      hue = (hue + 19) % 360;
      color = hslToHex(hue, 0.9, 0.64);
    }
    slotColor.set(i, color);
    used.add(color.toLowerCase());
  }
  return slotColor.get(index) ?? LAB_PALETTE.series[0];
}

/** Inputs and selects. Zinc-400 borders clear WCAG 3:1 against zinc-950; text is zinc-50. */
export const labControl =
  "rounded border border-zinc-400 bg-white text-zinc-950 dark:border-zinc-400 dark:bg-zinc-900 dark:text-zinc-50 dark:[color-scheme:dark]";

export const labLabel = "text-xs font-medium text-zinc-700 dark:text-zinc-300";

export const labCard = "rounded-xl border border-zinc-300 bg-white dark:border-zinc-500 dark:bg-zinc-950";

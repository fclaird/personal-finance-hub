/** Recharts pie + allocation charts share this palette (earth tones). */
export const EARTH_TONE_PIE_COLORS = [
  "#0f766e", // deep teal
  "#4d7c0f", // rich olive
  "#c2410f", // warm terracotta
  "#d97706", // golden amber
  "#10b981", // vibrant forest green
  "#b45309", // earthy brown-orange
  "#14b8a6", // sage teal
  "#b91c1c", // burnt sienna
  "#166534", // deep moss
  "#ca8a04", // warm ochre
] as const;

/** Extra hues so many underlyings do not repeat until palette + extras are exhausted. */
const EXTENDED_PIE_COLORS = [
  ...EARTH_TONE_PIE_COLORS,
  "#7c3aed", // violet
  "#db2777", // pink
  "#2563eb", // blue
  "#0891b2", // cyan
  "#65a30d", // lime
  "#c026d3", // fuchsia
  "#ea580c", // orange
  "#4f46e5", // indigo
  "#0d9488", // teal 600
  "#a16207", // yellow-700
  "#be123c", // rose 700
  "#475569", // slate 600
] as const;

export function distinctColorForIndex(i: number): string {
  if (i < EXTENDED_PIE_COLORS.length) return EXTENDED_PIE_COLORS[i]!;
  // Golden-angle hues for any further series (still stable per index).
  const hue = Math.round((i * 137.508) % 360);
  return `hsl(${hue} 72% 56%)`;
}

function hexToRgb(hex: string): [number, number, number] | null {
  const h = hex.replace("#", "").trim();
  if (h.length === 3) {
    return [
      parseInt(h[0]! + h[0], 16),
      parseInt(h[1]! + h[1], 16),
      parseInt(h[2]! + h[2], 16),
    ];
  }
  if (h.length === 6) {
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  return null;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const sn = s / 100;
  const ln = l / 100;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = ln - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) {
    r = c;
    g = x;
  } else if (h < 120) {
    r = x;
    g = c;
  } else if (h < 180) {
    g = c;
    b = x;
  } else if (h < 240) {
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

function colorToRgb(color: string): [number, number, number] | null {
  if (color.startsWith("#")) return hexToRgb(color);
  const hsl = color.match(/^hsl\((\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%\)$/);
  if (hsl) return hslToRgb(Number(hsl[1]), Number(hsl[2]), Number(hsl[3]));
  return null;
}

function colorDistance(a: string, b: string): number {
  const ra = colorToRgb(a);
  const rb = colorToRgb(b);
  if (!ra || !rb) return 0;
  const dr = ra[0] - rb[0];
  const dg = ra[1] - rb[1];
  const db = ra[2] - rb[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/**
 * Pick colors so consecutive entries (treemap layout order) are as visually distinct as possible.
 */
export function assignColorsForAdjacentContrast(count: number): string[] {
  if (count <= 0) return [];
  const pool: string[] = [...EXTENDED_PIE_COLORS];
  const targetPool = Math.max(count, EXTENDED_PIE_COLORS.length);
  while (pool.length < targetPool) {
    pool.push(distinctColorForIndex(pool.length));
  }

  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    let best = pool[0]!;
    let bestScore = -1;
    for (const c of pool) {
      let score = Number.POSITIVE_INFINITY;
      if (out.length > 0) score = Math.min(score, colorDistance(c, out[out.length - 1]!));
      if (out.length > 1) score = Math.min(score, colorDistance(c, out[out.length - 2]!) * 0.85);
      score -= out.filter((x) => x === c).length * 40;
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    out.push(best);
  }
  return out;
}

/**
 * Map symbol → color using treemap layout order (largest → smallest), not alphabetical order.
 */
export function assignEarthToneColorsByLayoutOrder(symbolsInLayoutOrder: string[]): Map<string, string> {
  const ordered = symbolsInLayoutOrder.map((s) => (s ?? "").trim()).filter(Boolean);
  const colors = assignColorsForAdjacentContrast(ordered.length);
  const m = new Map<string, string>();
  ordered.forEach((sym, i) => m.set(sym, colors[i] ?? distinctColorForIndex(i)));
  return m;
}

/**
 * One color per unique symbol, stable order: alphabetically (case-insensitive), with `"Other"` last.
 * Reuses the earth-tone palette in order; only wraps after all palette slots are used.
 */
export function assignEarthToneColorsBySymbols(symbols: string[]): Map<string, string> {
  const uniq = [...new Set(symbols.map((s) => (s ?? "").trim()).filter(Boolean))];
  const rest = uniq.filter((s) => s !== "Other").sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  const ordered = [...rest];
  if (uniq.includes("Other")) ordered.push("Other");
  const m = new Map<string, string>();
  ordered.forEach((sym, i) => m.set(sym, distinctColorForIndex(i)));
  return m;
}

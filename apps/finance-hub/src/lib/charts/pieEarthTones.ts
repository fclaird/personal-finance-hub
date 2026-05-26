/** Recharts pie + allocation charts share this palette (earth tones, no purple/violet). */
export const EARTH_TONE_PIE_COLORS = [
  "#0f766e", // deep teal
  "#c2410c", // terracotta
  "#2563eb", // royal blue
  "#ca8a04", // warm ochre
  "#b91c1c", // burnt red
  "#059669", // emerald
  "#ea580c", // orange
  "#0369a1", // sky blue
  "#4d7c0f", // olive
  "#0d9488", // cyan-teal
] as const;

/** Extra hues — blues, greens, reds, oranges, teals, slates only (no purple/fuchsia/indigo). */
const EXTENDED_PIE_COLORS = [
  ...EARTH_TONE_PIE_COLORS,
  "#dc2626", // red
  "#d97706", // amber
  "#16a34a", // green
  "#0891b2", // cyan
  "#1d4ed8", // blue
  "#b45309", // brown-orange
  "#15803d", // forest
  "#0e7490", // dark cyan
  "#475569", // slate
  "#a16207", // gold-brown
  "#be123c", // rose
  "#065f46", // deep emerald
  "#92400e", // brown
  "#1e40af", // navy
  "#14b8a6", // teal
  "#65a30d", // lime-olive
] as const;

const PURPLE_HUE_MIN = 250;
const PURPLE_HUE_MAX = 310;

function skipPurpleHue(hue: number): number {
  let h = ((hue % 360) + 360) % 360;
  if (h >= PURPLE_HUE_MIN && h <= PURPLE_HUE_MAX) {
    h = (h + 75) % 360;
  }
  return h;
}

export function distinctColorForIndex(i: number): string {
  if (i < EXTENDED_PIE_COLORS.length) return EXTENDED_PIE_COLORS[i]!;
  const hue = skipPurpleHue(Math.round(i * 137.508));
  return `hsl(${hue} 68% 48%)`;
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
 * Pick colors so consecutive entries (pie / treemap layout order) are as visually distinct as possible.
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
 * Map symbol → color using layout order (largest → smallest), maximizing contrast between neighbors.
 */
export function assignEarthToneColorsByLayoutOrder(symbolsInLayoutOrder: string[]): Map<string, string> {
  const ordered = symbolsInLayoutOrder.map((s) => (s ?? "").trim()).filter(Boolean);
  const colors = assignColorsForAdjacentContrast(ordered.length);
  const m = new Map<string, string>();
  ordered.forEach((sym, i) => m.set(sym, colors[i] ?? distinctColorForIndex(i)));
  return m;
}

/**
 * One color per unique symbol. Preserves caller order (e.g. pie size rank) for adjacent contrast; `"Other"` last.
 */
export function assignEarthToneColorsBySymbols(symbols: string[]): Map<string, string> {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const raw of symbols) {
    const s = (raw ?? "").trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    ordered.push(s);
  }
  const otherIdx = ordered.indexOf("Other");
  if (otherIdx >= 0) {
    ordered.splice(otherIdx, 1);
    ordered.push("Other");
  }
  return assignEarthToneColorsByLayoutOrder(ordered);
}

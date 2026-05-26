import type { CSSProperties } from "react";

/** Daily % change at which color reaches full intensity (fractional, e.g. 0.08 = 8%). */
export const DAILY_PERF_CAP_FRAC = 0.08;

const NEUTRAL_ABS_FRAC = 0.00012; // ~1.2 bps — flat-ish names read as distinct band

/** High-contrast label on green/red performance tiles (matches treemap treatment). */
export const PERF_CELL_LABEL_COLOR = "#f8fafc";
export const PERF_CELL_LABEL_SHADOW =
  "0 1px 2px rgba(0,0,0,0.9), 0 0 1px rgba(0,0,0,0.7)";

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Nonlinear magnitude in [0, 1] so small intraday moves read as visibly different
 * (exponent < 1 stretches the low end; cap at DAILY_PERF_CAP_FRAC).
 */
export function dailyPerfMagnitude(pctFrac: number | null): number {
  if (pctFrac == null || !Number.isFinite(pctFrac)) return 0;
  const u = clamp(Math.abs(pctFrac) / DAILY_PERF_CAP_FRAC, 0, 1);
  return Math.pow(u, 0.55);
}

type PerfHsl = { h: number; s: number; l: number };

function perfHsl(pctFrac: number | null): PerfHsl | null {
  if (pctFrac == null || !Number.isFinite(pctFrac)) return null;
  const pts = pctFrac * 100;
  if (Math.abs(pts) < NEUTRAL_ABS_FRAC * 100) {
    return { h: 222, s: 22, l: 30 };
  }
  const m = dailyPerfMagnitude(pctFrac);
  if (pts > 0) {
    return {
      h: 158 - m * 28,
      s: 38 + m * 42,
      l: 26 + m * 20,
    };
  }
  return {
    h: 352 + m * 8,
    s: 42 + m * 48,
    l: 28 + m * 18,
  };
}

function hslString({ h, s, l }: PerfHsl): string {
  return `hsl(${h} ${s}% ${l}%)`;
}

/** Foreground for text sitting on perf-colored tiles (heatmap, option-flow rows). */
export function perfCellForegroundStyle(): CSSProperties {
  return {
    color: PERF_CELL_LABEL_COLOR,
    textShadow: PERF_CELL_LABEL_SHADOW,
  };
}

/** Background + readable foreground for full-width perf rows. */
export function perfCellRowStyle(pctFrac: number | null): CSSProperties {
  return {
    ...heatmapCellStyle(pctFrac),
    ...perfCellForegroundStyle(),
  };
}

/** Inline styles for heatmap grid cells (dark UI). */
export function heatmapCellStyle(pctFrac: number | null): CSSProperties {
  if (pctFrac == null || !Number.isFinite(pctFrac)) {
    return {
      backgroundColor: "rgba(51,65,85,0.55)",
      borderColor: "rgba(148,163,184,0.35)",
      boxShadow: "inset 0 1px 0 0 rgba(255,255,255,0.06)",
    };
  }
  const hsl = perfHsl(pctFrac);
  if (!hsl) {
    return {
      backgroundColor: "rgba(51,65,85,0.55)",
      borderColor: "rgba(148,163,184,0.35)",
      boxShadow: "inset 0 1px 0 0 rgba(255,255,255,0.06)",
    };
  }
  const pts = pctFrac * 100;
  const m = dailyPerfMagnitude(pctFrac);
  if (Math.abs(pts) < NEUTRAL_ABS_FRAC * 100) {
    return {
      backgroundColor: hslString(hsl),
      borderColor: "rgba(129,140,248,0.4)",
      boxShadow: "inset 0 1px 0 0 rgba(255,255,255,0.1)",
    };
  }
  if (pts > 0) {
    const glow = 0.2 + m * 0.35;
    return {
      backgroundColor: hslString(hsl),
      borderColor: `hsla(${hsl.h} ${Math.min(96, hsl.s + 12)}% 55% / ${0.4 + m * 0.35})`,
      boxShadow: `0 0 20px -4px hsla(${hsl.h} ${hsl.s}% 50% / ${glow}), inset 0 1px 0 0 rgba(255,255,255,${0.1 + m * 0.12})`,
    };
  }
  const glow = 0.18 + m * 0.32;
  return {
    backgroundColor: hslString(hsl),
    borderColor: `hsla(${hsl.h} ${Math.min(96, hsl.s + 8)}% 58% / ${0.38 + m * 0.38})`,
    boxShadow: `0 0 20px -4px hsla(${hsl.h} ${hsl.s}% 48% / ${glow}), inset 0 1px 0 0 rgba(255,255,255,${0.07 + m * 0.1})`,
  };
}

/** Solid fill for treemap / charts (same scale as heatmap). */
export function treemapFillForChange(pctFrac: number | null): string {
  if (pctFrac == null || !Number.isFinite(pctFrac)) return "rgb(51 65 85 / 0.85)";
  const hsl = perfHsl(pctFrac);
  if (!hsl) return "rgb(51 65 85 / 0.85)";
  return hslString(hsl);
}

/** Label color on perf-colored tiles — always light with shadow applied separately. */
export function treemapLabelColor(_pctFrac: number | null): string {
  return PERF_CELL_LABEL_COLOR;
}

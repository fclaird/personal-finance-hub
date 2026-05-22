import type { CSSProperties } from "react";

/** Daily % change at which color reaches full intensity (fractional, e.g. 0.08 = 8%). */
export const DAILY_PERF_CAP_FRAC = 0.08;

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

const NEUTRAL_ABS_FRAC = 0.00012; // ~1.2 bps — flat-ish names read as distinct band

/** Inline styles for heatmap grid cells (dark UI). */
export function heatmapCellStyle(pctFrac: number | null): CSSProperties {
  if (pctFrac == null || !Number.isFinite(pctFrac)) {
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
      backgroundColor: "hsl(222 22% 22%)",
      borderColor: "rgba(129,140,248,0.35)",
      boxShadow: "inset 0 1px 0 0 rgba(255,255,255,0.08)",
    };
  }
  if (pts > 0) {
    const h = 158 - m * 28;
    const s = 38 + m * 42;
    const l = 22 + m * 18;
    const glow = 0.2 + m * 0.35;
    return {
      backgroundColor: `hsl(${h} ${s}% ${l}%)`,
      borderColor: `hsla(${h} ${Math.min(96, s + 12)}% 55% / ${0.4 + m * 0.35})`,
      boxShadow: `0 0 20px -4px hsla(${h} ${s}% 50% / ${glow}), inset 0 1px 0 0 rgba(255,255,255,${0.1 + m * 0.12})`,
    };
  }
  const h = 352 + m * 8;
  const s = 42 + m * 48;
  const l = 24 + m * 16;
  const glow = 0.18 + m * 0.32;
  return {
    backgroundColor: `hsl(${h} ${s}% ${l}%)`,
    borderColor: `hsla(${h} ${Math.min(96, s + 8)}% 58% / ${0.38 + m * 0.38})`,
    boxShadow: `0 0 20px -4px hsla(${h} ${s}% 48% / ${glow}), inset 0 1px 0 0 rgba(255,255,255,${0.07 + m * 0.1})`,
  };
}

/** Solid fill for treemap / charts (same scale as heatmap). */
export function treemapFillForChange(pctFrac: number | null): string {
  if (pctFrac == null || !Number.isFinite(pctFrac)) return "rgb(51 65 85 / 0.85)";
  const pts = pctFrac * 100;
  const m = dailyPerfMagnitude(pctFrac);
  if (Math.abs(pts) < NEUTRAL_ABS_FRAC * 100) return "hsl(222 22% 28%)";
  if (pts > 0) {
    const h = 158 - m * 28;
    const s = 38 + m * 42;
    const l = 24 + m * 16;
    return `hsl(${h} ${s}% ${l}%)`;
  }
  const h = 352 + m * 8;
  const s = 42 + m * 48;
  const l = 26 + m * 14;
  return `hsl(${h} ${s}% ${l}%)`;
}

export function treemapLabelColor(pctFrac: number | null): string {
  if (pctFrac == null || !Number.isFinite(pctFrac)) return "rgb(226 232 240)";
  const m = dailyPerfMagnitude(pctFrac);
  return m > 0.35 ? "rgb(15 23 42)" : "rgb(248 250 252)";
}

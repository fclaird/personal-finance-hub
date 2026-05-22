import type { TrackingMode } from "./types";

export type TrackingModeTheme = {
  mode: TrackingMode;
  /** Chart / panel wrapper */
  panelClass: string;
  /** Inner chart container (canvas border) */
  chartWrapperClass: string;
  /** Active mode toggle pill */
  toggleActiveClass: string;
  /** Inactive mode toggle */
  toggleInactiveClass: string;
  /** Section header left accent */
  headerAccentClass: string;
  /** Info banner */
  bannerClass: string;
  /** Selected year pill (backtest only) */
  yearPillActiveClass: string;
  /** Selected dividend mode pill */
  dividendPillActiveClass: string;
  /** Dot indicator for portfolio list */
  dotClass: string;
  /** Recharts grid stroke color (CSS color) */
  gridStroke: string;
  /** Recharts axis stroke color (CSS color) */
  axisStroke: string;
  /** Recharts grid line opacity (0–1) */
  gridStrokeOpacity: number;
};

export function trackingModeTheme(mode: TrackingMode): TrackingModeTheme {
  if (mode === "live") {
    return {
      mode: "live",
      panelClass:
        "rounded-2xl border-4 border-blue-500 bg-blue-50/70 p-4 shadow-lg shadow-blue-500/30 transition-colors duration-200 dark:border-blue-400 dark:bg-blue-950/40 dark:shadow-blue-500/15 sm:p-6",
      chartWrapperClass:
        "rounded-xl border-2 border-blue-400/80 bg-blue-50/50 p-2 dark:border-blue-500/60 dark:bg-blue-950/25",
      toggleActiveClass: "bg-blue-600 text-white shadow dark:bg-blue-500 dark:text-blue-950",
      toggleInactiveClass:
        "border border-zinc-300 bg-white text-zinc-800 hover:border-blue-300 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:border-blue-400/50",
      headerAccentClass: "border-l-4 border-blue-500 pl-3",
      bannerClass:
        "rounded-lg border-2 border-blue-300 bg-blue-50 px-3 py-2 text-sm text-blue-950 dark:border-blue-700 dark:bg-blue-950/50 dark:text-blue-100",
      yearPillActiveClass: "bg-blue-600 text-white dark:bg-blue-500 dark:text-blue-950",
      dividendPillActiveClass: "bg-blue-600 text-white dark:bg-blue-500 dark:text-blue-950",
      dotClass: "bg-blue-500",
      gridStroke: "#3b82f6",
      axisStroke: "#2563eb",
      gridStrokeOpacity: 0.45,
    };
  }

  return {
    mode: "backtest",
    panelClass:
      "rounded-2xl border-4 border-amber-500 bg-amber-50/70 p-4 shadow-lg shadow-amber-500/30 transition-colors duration-200 dark:border-amber-400 dark:bg-amber-950/40 dark:shadow-amber-500/15 sm:p-6",
    chartWrapperClass:
      "rounded-xl border-2 border-amber-400/80 bg-amber-50/50 p-2 dark:border-amber-500/60 dark:bg-amber-950/25",
    toggleActiveClass: "bg-amber-600 text-white shadow dark:bg-amber-500 dark:text-amber-950",
    toggleInactiveClass:
      "border border-zinc-300 bg-white text-zinc-800 hover:border-amber-300 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:border-amber-400/50",
    headerAccentClass: "border-l-4 border-amber-500 pl-3",
    bannerClass:
      "rounded-lg border-2 border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-100",
    yearPillActiveClass: "bg-amber-600 text-white dark:bg-amber-500 dark:text-amber-950",
    dividendPillActiveClass: "bg-amber-600 text-white dark:bg-amber-500 dark:text-amber-950",
    dotClass: "bg-amber-500",
    gridStroke: "#f59e0b",
    axisStroke: "#d97706",
    gridStrokeOpacity: 0.45,
  };
}

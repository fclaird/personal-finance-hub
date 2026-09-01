import { formatUsd2 } from "@/lib/format";

export const TERMINAL_PERF_DISPLAY_STORAGE_KEY = "terminal_perf_display_v1";

export type TerminalPerfDisplayMode = "stock_pct" | "position_pct" | "position_dollars";

export const TERMINAL_PERF_DISPLAY_MODES: readonly TerminalPerfDisplayMode[] = [
  "stock_pct",
  "position_pct",
  "position_dollars",
] as const;

export const TERMINAL_PERF_DISPLAY_LABEL: Record<TerminalPerfDisplayMode, string> = {
  stock_pct: "Stock %",
  position_pct: "Position %",
  position_dollars: "Position $",
};

export function readTerminalPerfDisplayMode(): TerminalPerfDisplayMode {
  try {
    const v = localStorage.getItem(TERMINAL_PERF_DISPLAY_STORAGE_KEY);
    if (v === "stock_pct" || v === "position_pct" || v === "position_dollars") return v;
  } catch {
    // ignore
  }
  return "stock_pct";
}

export function writeTerminalPerfDisplayMode(mode: TerminalPerfDisplayMode): void {
  try {
    localStorage.setItem(TERMINAL_PERF_DISPLAY_STORAGE_KEY, mode);
  } catch {
    // ignore
  }
}

/** Day return on exposure: day P/L ÷ start-of-day exposure MV. */
export function underlyingDayReturnFrac(dayPl: number, exposureMv: number): number | null {
  if (!Number.isFinite(dayPl) || !Number.isFinite(exposureMv)) return null;
  const start = exposureMv - dayPl;
  if (!Number.isFinite(start) || Math.abs(start) < 1) return null;
  return dayPl / start;
}

export type HeatmapPerfView = {
  colorFrac: number | null;
  perfLabel: string;
};

function formatPctLabel(frac: number | null): string {
  if (frac == null || !Number.isFinite(frac)) return "—";
  const pct = frac * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

export function resolveHeatmapPerfView(params: {
  mode: TerminalPerfDisplayMode;
  stockChangeFrac: number | null;
  dayPl: number | null | undefined;
  exposureMv: number | null | undefined;
  mask?: boolean;
}): HeatmapPerfView {
  const { mode, stockChangeFrac, dayPl, exposureMv, mask } = params;
  const pl = dayPl != null && Number.isFinite(dayPl) ? dayPl : null;
  const mv = exposureMv != null && Number.isFinite(exposureMv) ? exposureMv : null;
  const posFrac = pl != null && mv != null ? underlyingDayReturnFrac(pl, mv) : null;

  if (mode === "stock_pct") {
    return { colorFrac: stockChangeFrac, perfLabel: formatPctLabel(stockChangeFrac) };
  }

  if (mode === "position_dollars") {
    if (pl == null) {
      return { colorFrac: stockChangeFrac, perfLabel: formatPctLabel(stockChangeFrac) };
    }
    const colorFrac = posFrac ?? (pl !== 0 && mv != null && mv > 0 ? pl / mv : null);
    return {
      colorFrac,
      perfLabel: formatUsd2(pl, { mask }),
    };
  }

  // position_pct — stock + options day P/L vs exposure
  if (posFrac != null) {
    return { colorFrac: posFrac, perfLabel: formatPctLabel(posFrac) };
  }
  return { colorFrac: stockChangeFrac, perfLabel: formatPctLabel(stockChangeFrac) };
}

export function perfDisplayCaption(mode: TerminalPerfDisplayMode): string {
  switch (mode) {
    case "stock_pct":
      return "Color = underlying stock % change (quote).";
    case "position_pct":
      return "Color = position day return % (stock + options on that name vs exposure MV).";
    case "position_dollars":
      return "Label = position day P/L ($); color uses position return % when available.";
  }
}

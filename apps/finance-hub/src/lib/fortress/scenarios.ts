import type { AdjBar } from "@/lib/market/adjustedClose";

/**
 * Index-level style shocks. Levels are Yahoo chart ^GSPC quote closes observed
 * 2026-11-15. They are index closes, not dividend-adjusted closes, and they are
 * not a name's own path. Expected shortfall and Monte Carlo are not these numbers.
 */
export const STYLE_SHOCK_SOURCE = "Yahoo chart ^GSPC daily close";
export const STYLE_SHOCK_OBSERVED = "2026-11-15";

export type StyleShock = {
  readonly id: string;
  readonly label: string;
  readonly startDate: string;
  readonly startLevel: number;
  readonly endDate: string;
  readonly endLevel: number;
  readonly source: string;
  readonly observed: string;
};

export const STYLE_SHOCKS: readonly StyleShock[] = [
  { id: "gfc", label: "2008-style equity decline", startDate: "2007-10-09", startLevel: 1565.15, endDate: "2009-03-09", endLevel: 676.53, source: STYLE_SHOCK_SOURCE, observed: STYLE_SHOCK_OBSERVED },
  { id: "covid", label: "2020-style equity decline", startDate: "2020-02-19", startLevel: 3386.15, endDate: "2020-03-23", endLevel: 2237.4, source: STYLE_SHOCK_SOURCE, observed: STYLE_SHOCK_OBSERVED },
  { id: "y2022", label: "2022-style equity decline", startDate: "2022-01-03", startLevel: 4796.56, endDate: "2022-10-12", endLevel: 3577.03, source: STYLE_SHOCK_SOURCE, observed: STYLE_SHOCK_OBSERVED },
];

export function shockFactor(shock: StyleShock): number {
  return shock.endLevel / shock.startLevel;
}

/** One user-entered gap. The source is the person, not a historical close. */
export function gapFactor(percent: number): { readonly factor: number } | { readonly factor: null; readonly reason: string } {
  if (!Number.isFinite(percent) || percent <= -100) return { factor: null, reason: "A gap must be a percent above -100." };
  return { factor: 1 + percent / 100 };
}

export type Replay = {
  readonly status: "known" | "unknown";
  readonly reason: string | null;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly startClose: number | null;
  readonly endClose: number | null;
  readonly factor: number | null;
  readonly source: string;
};

/** The name's own adjusted closes inside the window. A missing bar stays unknown. */
export function replayAdjusted(bars: readonly AdjBar[] | null, start: string, end: string): Replay {
  const source = "yahoo-adjusted yahoo-adjclose-v1";
  if (!bars || bars.length === 0) return { status: "unknown", reason: "No adjusted closes are loaded for this name.", startDate: null, endDate: null, startClose: null, endClose: null, factor: null, source };
  const ordered = [...bars].sort((a, b) => a.date.localeCompare(b.date));
  const first = ordered.find((bar) => bar.date >= start && bar.date <= end);
  const last = [...ordered].reverse().find((bar) => bar.date >= start && bar.date <= end);
  if (!first || !last || first.date === last.date) {
    return { status: "unknown", reason: "The adjusted series does not cover this window.", startDate: null, endDate: null, startClose: null, endClose: null, factor: null, source };
  }
  return {
    status: "known",
    reason: null,
    startDate: first.date,
    endDate: last.date,
    startClose: first.adjClose,
    endClose: last.adjClose,
    factor: last.adjClose / first.adjClose,
    source,
  };
}

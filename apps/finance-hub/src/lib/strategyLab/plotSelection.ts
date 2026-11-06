/** Which structure tiles are drawn on the P&L chart and the delta chart. Not stored. */

export type PlotChart = "pnl" | "delta";

export type PlotLists = {
  readonly link: boolean;
  readonly pnl: readonly string[];
  readonly delta: readonly string[];
};

export type PlotAction =
  | { readonly kind: "toggle"; readonly chart: PlotChart; readonly id: string }
  | { readonly kind: "add"; readonly chart: PlotChart; readonly id: string }
  | { readonly kind: "only"; readonly chart: PlotChart; readonly id: string }
  | { readonly kind: "all"; readonly chart: PlotChart; readonly universe: readonly string[] }
  | { readonly kind: "none"; readonly chart: PlotChart }
  | { readonly kind: "invert"; readonly chart: PlotChart; readonly universe: readonly string[] }
  | { readonly kind: "link"; readonly on: boolean; readonly universe: readonly string[] };

export function togglePlotId(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id];
}

export function plotAll(universe: readonly string[]): string[] {
  return [...universe];
}

export function plotNone(): string[] {
  return [];
}

/** Universe order, so the chip row does not jump. */
export function invertPlotIds(ids: readonly string[], universe: readonly string[]): string[] {
  const on = new Set(ids);
  return universe.filter((id) => !on.has(id));
}

function nextIds(current: readonly string[], action: PlotAction): string[] {
  if (action.kind === "toggle") return togglePlotId(current, action.id);
  if (action.kind === "add") return current.includes(action.id) ? [...current] : [...current, action.id];
  if (action.kind === "only") return [action.id];
  if (action.kind === "all") return plotAll(action.universe);
  if (action.kind === "none") return plotNone();
  if (action.kind === "invert") return invertPlotIds(current, action.universe);
  return [...current];
}

/**
 * Linked charts share one list. Turning the link on keeps every structure that was on either chart.
 * Turning it off leaves the two lists equal, so they can diverge on the next click.
 */
export function applyPlotAction(state: PlotLists, action: PlotAction): PlotLists {
  if (action.kind === "link") {
    if (!action.on) return { link: false, pnl: [...state.pnl], delta: state.link ? [...state.pnl] : [...state.delta] };
    const union = action.universe.filter((id) => state.pnl.includes(id) || state.delta.includes(id));
    return { link: true, pnl: union, delta: union };
  }
  const current = action.chart === "delta" && !state.link ? state.delta : state.pnl;
  const next = nextIds(current, action);
  if (state.link) return { link: true, pnl: next, delta: next };
  if (action.chart === "delta") return { link: false, pnl: [...state.pnl], delta: next };
  return { link: false, pnl: next, delta: [...state.delta] };
}

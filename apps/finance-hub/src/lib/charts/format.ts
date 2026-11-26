import type { ChartQuoteMeta, ExtendedQuote } from "@/lib/charts/types";

export function formatPx(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatChange(change: number | null, pct: number | null): string {
  if (change == null || pct == null || !Number.isFinite(change) || !Number.isFinite(pct)) return "—";
  const sign = change > 0 ? "+" : "";
  const pctSign = pct > 0 ? "+" : "";
  return `${sign}${change.toFixed(2)} (${pctSign}${pct.toFixed(2)}%)`;
}

export function sessionBadge(meta: ChartQuoteMeta | null): { label: "Pre" | "Post"; quote: ExtendedQuote } | null {
  if (!meta) return null;
  const state = (meta.marketState ?? "").toUpperCase();
  if (state.startsWith("PRE") && meta.preMarket) return { label: "Pre", quote: meta.preMarket };
  if (meta.postMarket && state !== "REGULAR") return { label: "Post", quote: meta.postMarket };
  return null;
}

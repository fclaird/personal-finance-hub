import type { NormalizedQuote } from "@/app/api/quotes/route";

export type MoversResult = {
  basketKey: string;
  asOf: string;
  gainers: NormalizedQuote[];
  losers: NormalizedQuote[];
};

function pct(q: NormalizedQuote) {
  const v = q.changePercent;
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return v;
}

export function computeMovers(basketKey: string, quotes: NormalizedQuote[], topN = 50): MoversResult {
  const asOf = new Date().toISOString();
  const withPct = quotes
    .map((q) => ({ q, p: pct(q) }))
    .filter((x) => x.p != null) as Array<{ q: NormalizedQuote; p: number }>;

  const gainers = [...withPct]
    .sort((a, b) => b.p - a.p || a.q.symbol.localeCompare(b.q.symbol))
    .slice(0, topN)
    .map((x) => x.q);

  const losers = [...withPct]
    .sort((a, b) => a.p - b.p || a.q.symbol.localeCompare(b.q.symbol))
    .slice(0, topN)
    .map((x) => x.q);

  return { basketKey, asOf, gainers, losers };
}


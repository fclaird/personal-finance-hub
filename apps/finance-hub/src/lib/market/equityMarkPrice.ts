export type QuoteLike = {
  last?: number | null;
  mark?: number | null;
  close?: number | null;
};

/** Normalized `/api/quotes` display price (last is already mark-aware server-side). */
export function liveEquityMarkPx(quote: QuoteLike | null | undefined): number | null {
  const px = quote?.last ?? quote?.mark ?? quote?.close ?? null;
  return px != null && Number.isFinite(px) && px > 0 ? px : null;
}

export function normalizeEquitySymbol(symbol: string): string {
  return (symbol ?? "").trim().toUpperCase();
}

export function resolveEquityMarkPx(
  symbol: string,
  live: Map<string, number>,
  pricePoints: Map<string, number>,
  snapshotImplied: number | null | undefined,
): number | null {
  const key = normalizeEquitySymbol(symbol);
  if (!key || key === "CASH") return key === "CASH" ? 1 : null;
  const livePx = live.get(key);
  if (livePx != null && Number.isFinite(livePx) && livePx > 0) return livePx;
  const qpx = pricePoints.get(key);
  if (qpx != null && Number.isFinite(qpx) && qpx > 0) return qpx;
  if (snapshotImplied != null && Number.isFinite(snapshotImplied) && snapshotImplied > 0) return snapshotImplied;
  return null;
}

/** Build underPx map from normalized `/api/quotes` rows. */
export function underPxMapFromNormalizedQuotes(
  quotes: Array<{ symbol?: string; last?: number | null; mark?: number | null; close?: number | null }>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const q of quotes) {
    const sym = normalizeEquitySymbol(q.symbol ?? "");
    const px = liveEquityMarkPx(q);
    if (sym && px != null) out.set(sym, px);
  }
  return out;
}

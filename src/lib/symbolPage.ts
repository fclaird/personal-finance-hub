/** Normalized ticker for URLs and comparisons. */
export function normTickerSymbol(s: string): string {
  return (s ?? "").trim().toUpperCase();
}

/** Path to the Terminal symbol detail page, or null if the ticker is empty. */
export function symbolPageHref(symbol: string): string | null {
  const s = normTickerSymbol(symbol);
  if (!s) return null;
  return `/terminal/symbol/${encodeURIComponent(s)}`;
}

type InstrumentLike = {
  securityType?: string | null;
  symbol?: string | null;
  underlyingSymbol?: string | null;
  effectiveUnderlyingSymbol?: string | null;
};

/**
 * Equity: use `symbol`. Options: prefer underlying so the terminal page loads the stock/ETF hub.
 */
export function symbolPageTargetFromInstrument(r: InstrumentLike): string {
  if (r.securityType === "option") {
    const u = (r.effectiveUnderlyingSymbol ?? r.underlyingSymbol ?? r.symbol ?? "").trim();
    return normTickerSymbol(u || (r.symbol ?? ""));
  }
  return normTickerSymbol(r.symbol ?? "");
}

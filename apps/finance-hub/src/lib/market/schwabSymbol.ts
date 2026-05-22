/** Normalize symbols for Schwab market-data requests. Preserves leading `/` for futures roots. */
export function normalizeSchwabQuoteSymbol(s: string): string {
  const t = (s ?? "").trim();
  if (!t) return "";
  if (t.startsWith("/")) return `/${t.slice(1).toUpperCase()}`;
  return t.toUpperCase();
}

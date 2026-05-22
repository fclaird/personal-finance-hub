/**
 * Schwab-style OCC symbols: root ticker, 6-digit date, C/P, 8-digit strike (thousandths).
 * Example: "RKLB  260116C00040000" → RKLB
 */
export function underlyingTickerFromOptionSymbol(symbol: string | null | undefined): string | null {
  if (!symbol) return null;
  const s = symbol.replace(/\s+/g, " ").trim();
  const m = s.match(/^(.+?)\s+(\d{6})([CP])(\d{8})$/);
  if (!m) return null;
  const root = m[1]!.trim();
  if (!root) return null;
  return root.toUpperCase();
}

export function normalizeOptionUnderlying(
  usSymbol: string | null | undefined,
  optionSymbol: string | null | undefined,
): string {
  const u = (usSymbol ?? "").trim();
  if (u) return u.toUpperCase();
  const parsed = underlyingTickerFromOptionSymbol(optionSymbol);
  if (parsed) return parsed;
  return "UNKNOWN";
}

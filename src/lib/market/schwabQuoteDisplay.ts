/**
 * Schwab `/quotes` often exposes both `lastPrice` (last trade) and `mark` (NBBO-derived / current).
 * For thin names, `lastPrice` can be very stale while `mark` tracks the live quote — prefer `mark`
 * when the two disagree materially. Treat non‑positive `lastPrice` as missing (0 is not "no data"
 * for `??` chains elsewhere).
 */
const DEFAULT_DIVERGENCE = 0.005; // 0.5%

export function schwabQuoteDisplayPrice(
  rawLast: number | null,
  mark: number | null,
  close: number | null,
  divergence = DEFAULT_DIVERGENCE,
): number | null {
  const L = rawLast != null && Number.isFinite(rawLast) && rawLast > 0 ? rawLast : null;
  const M = mark != null && Number.isFinite(mark) && mark > 0 ? mark : null;
  const C = close != null && Number.isFinite(close) && close > 0 ? close : null;
  if (L != null && M != null) {
    const denom = Math.max(L, M);
    if (denom > 0 && Math.abs(L - M) / denom > divergence) {
      return M;
    }
    return L;
  }
  return L ?? M ?? C;
}

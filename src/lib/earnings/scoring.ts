/**
 * IV “rank” as percentile within 52-week IV band (Schwab / chain-derived).
 * Returns 0–100, or null if inputs invalid.
 */
export function computeIvRankPct(iv: number, iv52wHigh: number, iv52wLow: number): number | null {
  if (![iv, iv52wHigh, iv52wLow].every((x) => typeof x === "number" && Number.isFinite(x))) return null;
  const span = iv52wHigh - iv52wLow;
  if (span <= 1e-9) return null;
  const pct = ((iv - iv52wLow) / span) * 100;
  return Math.max(0, Math.min(100, pct));
}

/**
 * Map typical 20-day average dollar volume (close × shares) to 0–100 for “how liquid vs most listed names”.
 * Log scale: ~$1M/day → low, ~$50M → mid, ~$1B+ → top (broad-market context, not earnings spikes).
 */
export function advToLiquidityScore(avgDollarVolume20d: number): number | null {
  if (!Number.isFinite(avgDollarVolume20d) || avgDollarVolume20d <= 0) return null;
  const x = Math.log10(Math.max(avgDollarVolume20d, 1));
  // ~$1M (log 6) → 0; ~$1B (log 9) → 100
  const s = ((x - 6) / 3) * 100;
  return Math.round(Math.max(0, Math.min(100, s)));
}

/**
 * Composite “earnings trade interest” score.
 * Prefers high IV rank (elevated vs its own range) and higher typical dollar liquidity.
 */
export function computeOpportunityScore(ivRankPct: number | null, dollarLiquidityScore: number | null): number {
  const ivPart = ivRankPct != null && Number.isFinite(ivRankPct) ? ivRankPct : null;
  const liqPart = dollarLiquidityScore != null && Number.isFinite(dollarLiquidityScore) ? dollarLiquidityScore : null;

  if (ivPart != null && liqPart != null) return Math.round(ivPart * 0.45 + liqPart * 0.55);
  if (ivPart != null) return Math.round(ivPart);
  if (liqPart != null) return Math.round(liqPart);
  return 0;
}

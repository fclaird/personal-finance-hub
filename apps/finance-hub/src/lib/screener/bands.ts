import type { CorrBand, MarketCapBand } from "@/lib/screener/types";

/**
 * Screen definitions applied to a cited market cap. These thresholds are not a vendor field.
 * Boundaries: mega ≥ $200B, large $10B–$200B, mid $2B–$10B, small $300M–$2B, micro below $300M.
 */
export const MARKET_CAP_BAND_RULES: Array<{ id: MarketCapBand; label: string; min: number; max: number }> = [
  { id: "mega", label: "Mega (≥ $200B)", min: 200e9, max: Number.POSITIVE_INFINITY },
  { id: "large", label: "Large ($10B–$200B)", min: 10e9, max: 200e9 },
  { id: "mid", label: "Mid ($2B–$10B)", min: 2e9, max: 10e9 },
  { id: "small", label: "Small ($300M–$2B)", min: 300e6, max: 2e9 },
  { id: "micro", label: "Micro (< $300M)", min: 0, max: 300e6 },
];

export function marketCapBand(usd: number): MarketCapBand | null {
  if (!Number.isFinite(usd) || usd < 0) return null;
  for (const rule of MARKET_CAP_BAND_RULES) {
    if (usd >= rule.min && usd < rule.max) return rule.id;
  }
  return null;
}

/**
 * Absolute-value bands. H is |ρ| ≥ 0.50, M is 0.25–0.49, L is below 0.25.
 * 0.50 is H. 0.25 is M.
 */
export function correlationBand(value: number): CorrBand | null {
  if (!Number.isFinite(value)) return null;
  const abs = Math.abs(value);
  if (abs >= 0.5) return "H";
  if (abs >= 0.25) return "M";
  return "L";
}

export function bandLabel(band: CorrBand): string {
  if (band === "H") return "H ≥ 0.50";
  if (band === "M") return "M 0.25–0.49";
  return "L < 0.25";
}

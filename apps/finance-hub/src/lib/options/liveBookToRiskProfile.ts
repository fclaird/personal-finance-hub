import type { OptionRiskPosition } from "@/lib/alerts/optionRisk";
import { sanitizeOptionIv } from "@/lib/alerts/optionRisk";
import {
  buildShortStrangleRiskProfile,
  type RiskProfileLeg,
  type RiskProfileModel,
} from "@/lib/options/shortStrangleRiskProfile";
import type { LiveStructureBook } from "@/lib/situations/liveStructures";

/** Map a live option-risk leg into a risk-profile leg (entry/mark/IV). */
export function optionRiskLegToRiskProfileLeg(leg: OptionRiskPosition): RiskProfileLeg | null {
  if (!leg.right || leg.strike == null || !(leg.strike > 0) || leg.quantity === 0) return null;
  const entryRaw =
    leg.avgPrice != null && Number.isFinite(leg.avgPrice) && leg.avgPrice > 0
      ? Math.abs(leg.avgPrice)
      : leg.markPrice != null && Number.isFinite(leg.markPrice) && leg.markPrice > 0
        ? Math.abs(leg.markPrice)
        : null;
  if (entryRaw == null) return null;
  const mark =
    leg.markPrice != null && Number.isFinite(leg.markPrice) && leg.markPrice > 0
      ? Math.abs(leg.markPrice)
      : null;
  return {
    right: leg.right,
    strike: leg.strike,
    quantity: leg.quantity,
    entryPrice: entryRaw,
    markPrice: mark,
    iv: sanitizeOptionIv(leg.iv),
  };
}

/**
 * Build a ToS-style risk profile model from a live structure book.
 * Returns null when legs lack strikes/entry needed for an expiration curve.
 */
export function liveBookToRiskProfile(book: LiveStructureBook): RiskProfileModel | null {
  const legs: RiskProfileLeg[] = [];
  for (const leg of book.legs) {
    const mapped = optionRiskLegToRiskProfileLeg(leg);
    if (mapped) legs.push(mapped);
  }
  if (legs.length === 0) return null;
  let spot =
    book.legs.map((l) => l.spot).find((s): s is number => s != null && Number.isFinite(s) && s > 0) ??
    null;
  // Prefer real OHLCV/equity spot; if still missing, mid of short put/call strikes so the spot line can draw.
  if (spot == null) {
    let put: number | null = null;
    let call: number | null = null;
    for (const leg of legs) {
      if (leg.quantity >= 0) continue;
      if (leg.right === "P") put = put == null ? leg.strike : Math.min(put, leg.strike);
      if (leg.right === "C") call = call == null ? leg.strike : Math.max(call, leg.strike);
    }
    if (put != null && call != null && put > 0 && call > 0) {
      spot = (put + call) / 2;
    }
  }
  return buildShortStrangleRiskProfile({
    legs,
    spot,
    dte: book.dte,
  });
}

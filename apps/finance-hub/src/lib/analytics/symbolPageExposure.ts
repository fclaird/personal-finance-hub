import type { Row } from "@/app/components/PositionsGroupedTable";
import { liveEquityMarkPx, type QuoteLike } from "@/lib/market/equityMarkPrice";

export type { QuoteLike };

export type SymbolPageExposure = {
  heldShares: number;
  synthShares: number;
  netShares: number;
  spotMv: number;
  synthMv: number;
  netMv: number;
  /** Implied equity mark from held stock rows (sum MV / sum qty). */
  impliedEquityPx: number | null;
};

function n0(v: number | null | undefined): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * Symbol-page exposure summary:
 * - Prefer the live equity quote (same as `/api/quotes` last) for spot and synthetic MV.
 * - Fall back to snapshot-implied price (sum stock MV / shares), then quote close.
 */
export function computeSymbolPageExposure(positions: Row[], quote: QuoteLike | null): SymbolPageExposure {
  let heldShares = 0;
  let spotMvSum = 0;
  let synthShares = 0;

  for (const r of positions) {
    if (r.securityType === "option") {
      const d = typeof r.delta === "number" && Number.isFinite(r.delta) ? r.delta : 0;
      synthShares += n0(r.quantity) * 100 * d;
      continue;
    }
    if (r.securityType === "cash") continue;
    heldShares += n0(r.quantity);
    spotMvSum += n0(r.marketValue);
  }

  const impliedEquityPx = heldShares > 0 ? spotMvSum / heldShares : null;
  const livePx = liveEquityMarkPx(quote);
  const equityPx = livePx ?? impliedEquityPx ?? quote?.close ?? 0;

  const spotMv = heldShares > 0 && equityPx > 0 ? heldShares * equityPx : spotMvSum;
  const synthMv = synthShares * equityPx;

  return {
    heldShares,
    synthShares,
    netShares: heldShares + synthShares,
    spotMv,
    synthMv,
    netMv: spotMv + synthMv,
    impliedEquityPx,
  };
}

/** Spot equity row price/MV at the live quote when this page already has it. */
export function symbolPageEquityRowMark(
  row: Row,
  quote: QuoteLike | null,
): { price: number | null; marketValue: number | null } {
  if (row.securityType === "option" || row.securityType === "cash") {
    return { price: row.price ?? null, marketValue: row.marketValue ?? null };
  }
  const livePx = liveEquityMarkPx(quote);
  const qty = row.quantity ?? 0;
  if (livePx != null && qty !== 0) {
    return { price: livePx, marketValue: livePx * qty };
  }
  return { price: row.price ?? null, marketValue: row.marketValue ?? null };
}

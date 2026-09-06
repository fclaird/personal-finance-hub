import type { SituationMemberView } from "@/lib/situations/apiTypes";

function absQty(q: number | null | undefined): number {
  return q != null && Number.isFinite(q) ? Math.abs(q) : 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

type Lot = {
  symbol: string;
  qtyRemaining: number;
  creditPerContract: number;
};

/** FIFO lots from open / roll_open fills (credits booked when structure was established). */
function buildOpenLots(priorMembers: SituationMemberView[]): Lot[] {
  const lots: Lot[] = [];
  for (const m of priorMembers) {
    if (m.role !== "open" && m.role !== "roll_open") continue;
    const qty = absQty(m.quantity);
    if (qty <= 0) continue;
    const net = m.netAmount != null && Number.isFinite(m.netAmount) ? m.netAmount : 0;
    lots.push({
      symbol: (m.symbol ?? "").trim(),
      qtyRemaining: qty,
      creditPerContract: net / qty,
    });
  }
  return lots;
}

/**
 * Realized G/L on closed legs vs the original credit those lots brought in.
 * Match same OCC symbol first (FIFO); leftover qty consumes FIFO across any symbol.
 * realized = matchedOpenCredit + closeNet (e.g. +$X open credit + −$Y buyback).
 */
export function realizedOnClosedLegs(
  closeMembers: SituationMemberView[],
  priorMembers: SituationMemberView[],
): number | null {
  if (!closeMembers.length) return null;
  const lots = buildOpenLots(priorMembers);
  if (!lots.length) return null;

  let realized = 0;
  let matchedAny = false;

  for (const close of closeMembers) {
    const closeQty = absQty(close.quantity);
    if (closeQty <= 0) continue;
    let qtyLeft = closeQty;
    const closeNet = close.netAmount != null && Number.isFinite(close.netAmount) ? close.netAmount : 0;
    const closeSym = (close.symbol ?? "").trim();
    let matchedOpenCredit = 0;

    const consume = (lot: Lot, take: number): number => {
      if (take <= 0 || lot.qtyRemaining <= 0) return 0;
      const used = Math.min(take, lot.qtyRemaining);
      matchedOpenCredit += lot.creditPerContract * used;
      lot.qtyRemaining -= used;
      return used;
    };

    if (closeSym) {
      for (const lot of lots) {
        if (qtyLeft <= 0) break;
        if (lot.symbol !== closeSym || lot.qtyRemaining <= 0) continue;
        qtyLeft -= consume(lot, qtyLeft);
        matchedAny = true;
      }
    }
    for (const lot of lots) {
      if (qtyLeft <= 0) break;
      if (lot.qtyRemaining <= 0) continue;
      qtyLeft -= consume(lot, qtyLeft);
      matchedAny = true;
    }

    const closedQty = closeQty - qtyLeft;
    if (closedQty > 0) {
      const allocatedCloseNet = closeNet * (closedQty / closeQty);
      realized += matchedOpenCredit + allocatedCloseNet;
    }
  }

  return matchedAny ? round2(realized) : null;
}

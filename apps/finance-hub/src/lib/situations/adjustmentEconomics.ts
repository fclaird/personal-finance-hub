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
 * Realized G/L per closed leg vs the original credit those lots brought in.
 * Same FIFO matching as realizedOnClosedLegs, but one result per close member
 * (lots are consumed in close order so totals sum to the combined figure).
 */
export function realizedPerClosedLeg(
  closeMembers: SituationMemberView[],
  priorMembers: SituationMemberView[],
): Array<{ transactionId: string; realized: number | null }> {
  const lots = buildOpenLots(priorMembers);
  const out: Array<{ transactionId: string; realized: number | null }> = [];

  for (const close of closeMembers) {
    const closeQty = absQty(close.quantity);
    if (closeQty <= 0 || !lots.length) {
      out.push({ transactionId: close.transactionId, realized: null });
      continue;
    }
    let qtyLeft = closeQty;
    const closeNet = close.netAmount != null && Number.isFinite(close.netAmount) ? close.netAmount : 0;
    const closeSym = (close.symbol ?? "").trim();
    let matchedOpenCredit = 0;
    let matchedAny = false;

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
    if (!matchedAny || closedQty <= 0) {
      out.push({ transactionId: close.transactionId, realized: null });
      continue;
    }
    const allocatedCloseNet = closeNet * (closedQty / closeQty);
    out.push({
      transactionId: close.transactionId,
      realized: round2(matchedOpenCredit + allocatedCloseNet),
    });
  }

  return out;
}

/**
 * Dollar amount shown on a Strategies tree close/leg fill row.
 * Always FIFO realized G/L vs opening credits — never the raw BTC debit.
 */
export function closedFillRowNet(
  closeMember: SituationMemberView,
  priorMembers: SituationMemberView[],
  stepNetFallback: number | null = null,
): number | null {
  const per = realizedPerClosedLeg([closeMember], priorMembers);
  return per[0]?.realized ?? stepNetFallback;
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
  const per = realizedPerClosedLeg(closeMembers, priorMembers);
  let realized = 0;
  let matchedAny = false;
  for (const p of per) {
    if (p.realized == null) continue;
    realized += p.realized;
    matchedAny = true;
  }
  return matchedAny ? round2(realized) : null;
}

/**
 * Book-level realized G/L: sum FIFO realized on every close / roll_close / leg
 * vs open / roll_open credits established earlier in the book.
 */
export function situationRealizedPnl(members: SituationMemberView[]): number | null {
  const sorted = [...members].sort(
    (a, b) =>
      a.tradeDate.localeCompare(b.tradeDate) ||
      roleSort(a.role) - roleSort(b.role) ||
      a.transactionId.localeCompare(b.transactionId),
  );
  const prior: SituationMemberView[] = [];
  let total = 0;
  let any = false;
  for (const m of sorted) {
    if (m.role === "open" || m.role === "roll_open") {
      prior.push(m);
      continue;
    }
    if (m.role === "roll_close" || m.role === "close" || m.role === "leg") {
      const r = realizedOnClosedLegs([m], prior);
      if (r != null) {
        total += r;
        any = true;
      }
      prior.push(m);
    }
  }
  return any ? round2(total) : null;
}

function roleSort(role: SituationMemberView["role"]): number {
  switch (role) {
    case "open":
      return 0;
    case "roll_close":
      return 1;
    case "roll_open":
      return 2;
    case "close":
      return 3;
    case "leg":
      return 4;
    default:
      return 5;
  }
}

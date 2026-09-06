import type { SituationMemberView } from "@/lib/situations/apiTypes";

function groupKey(m: SituationMemberView): string {
  const orderId = (m.orderId ?? "").trim();
  if (!orderId) {
    // Missing orderId: never clump across fills (intentional separate orders).
    return `solo:${m.transactionId}|${m.role}`;
  }
  return `${orderId}|${m.symbol ?? ""}|${m.role}`;
}

function absQty(q: number | null | undefined): number {
  return q != null && Number.isFinite(q) ? Math.abs(q) : 0;
}

/** Merge Schwab partial fills that share orderId + symbol + role into one net line. */
export function clumpPartialFills(members: SituationMemberView[]): SituationMemberView[] {
  if (members.length <= 1) return members;

  const buckets = new Map<string, SituationMemberView[]>();
  const order: string[] = [];
  for (const m of members) {
    const key = groupKey(m);
    if (!buckets.has(key)) {
      buckets.set(key, []);
      order.push(key);
    }
    buckets.get(key)!.push(m);
  }

  return order.map((key) => {
    const group = buckets.get(key)!;
    if (group.length === 1) return group[0]!;

    // Stable: earliest tradeTime, then original order
    const sorted = [...group].sort((a, b) => {
      const ta = a.tradeTime ? Date.parse(a.tradeTime) : Number.POSITIVE_INFINITY;
      const tb = b.tradeTime ? Date.parse(b.tradeTime) : Number.POSITIVE_INFINITY;
      if (ta !== tb) return ta - tb;
      return a.transactionId.localeCompare(b.transactionId);
    });
    const first = sorted[0]!;

    let qtySum = 0;
    let sawQty = false;
    let netSum = 0;
    let sawNet = false;
    let pxNum = 0;
    let pxDen = 0;
    let deltaNum = 0;
    let deltaDen = 0;
    const txnIds: string[] = [];

    for (const m of sorted) {
      txnIds.push(m.transactionId);
      if (m.quantity != null && Number.isFinite(m.quantity)) {
        qtySum += m.quantity;
        sawQty = true;
        const w = absQty(m.quantity);
        if (m.price != null && Number.isFinite(m.price) && w > 0) {
          pxNum += w * m.price;
          pxDen += w;
        }
        if (m.deltaAtFill != null && Number.isFinite(m.deltaAtFill) && w > 0) {
          deltaNum += w * m.deltaAtFill;
          deltaDen += w;
        }
      }
      if (m.netAmount != null && Number.isFinite(m.netAmount)) {
        netSum += m.netAmount;
        sawNet = true;
      }
    }

    const vwap = pxDen > 0 ? Math.round((pxNum / pxDen) * 1e6) / 1e6 : first.price;
    const delta =
      deltaDen > 0 ? Math.round((deltaNum / deltaDen) * 1e6) / 1e6 : first.deltaAtFill ?? null;

    return {
      ...first,
      transactionId: txnIds.join("|"),
      quantity: sawQty ? qtySum : first.quantity,
      netAmount: sawNet ? Math.round(netSum * 100) / 100 : first.netAmount,
      price: vwap,
      deltaAtFill: delta,
      // Keep earliest tradeTime (already on first after sort)
      tradeTime: first.tradeTime,
      tradeDate: first.tradeDate,
    };
  });
}

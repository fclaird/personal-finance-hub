import type { SituationMemberView } from "@/lib/situations/apiTypes";
import { inferInstructionKind } from "@/lib/situations/fromBrokerTx";
import type { SchwabTxnItem, SchwabTxnRaw } from "@/lib/schwab/transactionNormalize";
import { securityLegsOf } from "@/lib/schwab/transactionNormalize";
import { parseOptionFromSchwabSymbol } from "@/lib/strategy/optionParse";

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function absQty(q: number | null): number {
  return q != null && Number.isFinite(q) ? Math.abs(q) : 0;
}

function isOptionItem(leg: SchwabTxnItem): boolean {
  const asset = (leg.instrument?.assetType ?? "").toUpperCase();
  if (asset === "OPTION") return true;
  return parseOptionFromSchwabSymbol(leg.instrument?.symbol) != null;
}

function optionItemsFromRaw(rawJson: string | null | undefined): SchwabTxnItem[] {
  if (!rawJson) return [];
  let raw: SchwabTxnRaw;
  try {
    raw = JSON.parse(rawJson) as SchwabTxnRaw;
  } catch {
    return [];
  }
  return securityLegsOf(raw).filter(isOptionItem);
}

function legQty(item: SchwabTxnItem): number | null {
  return asNumber(item.quantity) ?? asNumber(item.amount);
}

/**
 * Signed cash for one option leg. Prefer Schwab `cost`; else price × qty × 100
 * with buy = debit (−) and sell = credit (+).
 */
export function optionLegSignedCash(item: SchwabTxnItem): number | null {
  const cost = asNumber(item.cost);
  if (cost != null) return cost;
  const qty = legQty(item);
  const price = asNumber(item.price);
  if (qty == null || price == null) return null;
  const inst = inferInstructionKind({
    instruction: item.instruction ?? null,
    positionEffect: item.positionEffect ?? null,
    quantity: qty,
  });
  const buy = inst === "buy_open" || inst === "buy_close";
  const sell = inst === "sell_open" || inst === "sell_close";
  const sign = buy ? -1 : sell ? 1 : qty < 0 ? 1 : -1;
  return sign * Math.abs(price) * Math.abs(qty) * 100;
}

/** Scale per-leg weights so they sum to the ticket net (commissions stay on the ticket). */
export function allocateLegNets(weights: number[], ticketNet: number | null): number[] {
  const n = weights.length;
  if (n === 0) return [];
  if (ticketNet == null || !Number.isFinite(ticketNet)) {
    return weights.map((w) => round2(w));
  }
  const sum = weights.reduce((a, b) => a + b, 0);
  if (Math.abs(sum) < 1e-9) {
    const each = round2(ticketNet / n);
    const out = Array.from({ length: n }, () => each);
    out[n - 1] = round2(ticketNet - each * (n - 1));
    return out;
  }
  const out = weights.map((w) => round2((w / sum) * ticketNet));
  const allocated = out.reduce((a, b) => a + b, 0);
  out[n - 1] = round2(out[n - 1]! + (ticketNet - allocated));
  return out;
}

function memberFromOptionLeg(
  base: SituationMemberView,
  item: SchwabTxnItem,
  netAmount: number | null,
): SituationMemberView {
  const symbol = (item.instrument?.symbol ?? "").trim() || base.symbol;
  const parsed = parseOptionFromSchwabSymbol(symbol);
  const putCall = (item.instrument?.putCall ?? "").toUpperCase();
  const right =
    parsed?.right ?? (putCall.startsWith("P") ? "P" : putCall.startsWith("C") ? "C" : base.right);
  const strike =
    parsed?.strike ??
    (typeof item.instrument?.strikePrice === "number" ? item.instrument.strikePrice : base.strike);
  const underlying =
    (item.instrument?.underlyingSymbol ?? parsed?.underlying ?? base.underlying ?? "")
      .trim()
      .toUpperCase() || base.underlying;
  return {
    ...base,
    symbol,
    underlying,
    expiration: parsed?.expiration ?? base.expiration,
    right,
    strike,
    price: asNumber(item.price) ?? base.price,
    quantity: legQty(item) ?? base.quantity,
    positionEffect: item.positionEffect ?? base.positionEffect,
    instruction: item.instruction ?? base.instruction,
    netAmount,
  };
}

/**
 * `broker_transactions` stores first-leg symbol/qty and the full ticket net.
 * FIFO realized matches by OCC symbol, so a 2+ leg TRADE must become one member
 * per option leg or the whole credit lands on the first wing.
 */
export function expandSituationMember(
  member: SituationMemberView,
  rawJson: string | null | undefined,
): SituationMemberView[] {
  const items = optionItemsFromRaw(rawJson);
  if (items.length <= 1) return [member];

  const notionals = items.map((item) => optionLegSignedCash(item));
  const weights = notionals.every((n) => n != null)
    ? (notionals as number[])
    : items.map((item) => {
        const q = absQty(legQty(item));
        return q > 0 ? q : 1;
      });
  const nets = allocateLegNets(weights, member.netAmount);
  return items.map((item, i) => {
    const row = memberFromOptionLeg(member, item, nets[i] ?? null);
    return {
      ...row,
      // Distinct ids so clumpPartialFills does not re-merge wings when orderId is absent.
      transactionId: `${member.transactionId}#${i}`,
    };
  });
}

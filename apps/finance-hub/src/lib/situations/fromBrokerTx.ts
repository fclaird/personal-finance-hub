import type Database from "better-sqlite3";

import type { SchwabTxnRaw } from "@/lib/schwab/transactionNormalize";
import { securityLegsOf } from "@/lib/schwab/transactionNormalize";
import { instructionKind, parseOptionFromSchwabSymbol, positionIsOpening } from "@/lib/strategy/optionParse";

/** Infer buy/sell open/close when Schwab omits instruction but has positionEffect + signed qty. */
export function inferInstructionKind(input: {
  instruction?: string | null;
  positionEffect?: string | null;
  quantity?: number | null;
}): ReturnType<typeof instructionKind> {
  const direct = instructionKind(input.instruction ?? null);
  if (direct !== "unknown") return direct;
  const effect = (input.positionEffect ?? "").toUpperCase();
  const qty = input.quantity;
  if (qty == null || !Number.isFinite(qty) || qty === 0) return "unknown";
  const sold = qty < 0;
  if (effect === "OPENING") return sold ? "sell_open" : "buy_open";
  if (effect === "CLOSING") return sold ? "sell_close" : "buy_close";
  // No effect: treat signed qty as open (common on sparse exports).
  return sold ? "sell_open" : "buy_open";
}

import type { LinkableLeg, LinkableTxn } from "@/lib/situations/types";

export function legsFromRawJson(rawJson: string, fallback?: {
  symbol?: string | null;
  underlying?: string | null;
  expiration?: string | null;
  right?: string | null;
  strike?: number | null;
  instruction?: string | null;
  positionEffect?: string | null;
  quantity?: number | null;
}): LinkableLeg[] {
  let raw: SchwabTxnRaw | null = null;
  try {
    raw = JSON.parse(rawJson) as SchwabTxnRaw;
  } catch {
    raw = null;
  }
  const items = raw ? securityLegsOf(raw) : [];
  const optionItems = items.filter((leg) => (leg.instrument?.assetType ?? "").toUpperCase() === "OPTION");
  if (optionItems.length) {
    return optionItems.map((leg) => {
      const parsed = parseOptionFromSchwabSymbol(leg.instrument?.symbol);
      const qty =
        typeof leg.quantity === "number"
          ? leg.quantity
          : typeof leg.amount === "number"
            ? leg.amount
            : null;
      const inst = inferInstructionKind({
        instruction: leg.instruction ?? null,
        positionEffect: leg.positionEffect ?? null,
        quantity: qty,
      });
      const putCall = (leg.instrument?.putCall ?? "").toUpperCase();
      return {
        symbol: (leg.instrument?.symbol ?? parsed?.underlying ?? "").trim(),
        underlying: (leg.instrument?.underlyingSymbol ?? parsed?.underlying ?? "").trim().toUpperCase(),
        expiration: parsed?.expiration ?? null,
        right: parsed?.right ?? (putCall.startsWith("P") ? "P" : putCall.startsWith("C") ? "C" : null),
        strike: parsed?.strike ?? (typeof leg.instrument?.strikePrice === "number" ? leg.instrument.strikePrice : null),
        instruction: inst,
        opening: positionIsOpening(leg.positionEffect ?? null, inst),
        quantity: qty,
      };
    });
  }
  if (!fallback) return [];
  const parsed = parseOptionFromSchwabSymbol(fallback.symbol);
  const inst = inferInstructionKind({
    instruction: fallback.instruction ?? null,
    positionEffect: fallback.positionEffect ?? null,
    quantity: fallback.quantity ?? null,
  });
  const rightRaw = (fallback.right ?? parsed?.right ?? "").toUpperCase();
  const right = rightRaw === "P" || rightRaw === "C" ? rightRaw : null;
  if (!parsed && !right && (fallback.symbol ?? "").toUpperCase().indexOf("OPTION") < 0) {
    // No option identity — skip equities.
    if (!fallback.expiration) return [];
  }
  return [
    {
      symbol: (fallback.symbol ?? "").trim(),
      underlying: (fallback.underlying ?? parsed?.underlying ?? "").trim().toUpperCase(),
      expiration: fallback.expiration ?? parsed?.expiration ?? null,
      right,
      strike: fallback.strike ?? parsed?.strike ?? null,
      instruction: inst,
      opening: positionIsOpening(fallback.positionEffect ?? null, inst),
      quantity: fallback.quantity ?? null,
    },
  ];
}

function orderIdFromRaw(rawJson: string): string | null {
  try {
    const raw = JSON.parse(rawJson) as { orderId?: string | number | null };
    if (raw.orderId == null || raw.orderId === "") return null;
    return String(raw.orderId);
  } catch {
    return null;
  }
}

function tradeTimeFromRaw(rawJson: string): string | null {
  try {
    const raw = JSON.parse(rawJson) as { time?: string | null };
    return typeof raw.time === "string" && raw.time ? raw.time : null;
  } catch {
    return null;
  }
}

export function loadLinkableBrokerTransactions(db: Database.Database): LinkableTxn[] {
  const rows = db
    .prepare(
      `
      SELECT
        id, account_id, trade_date, net_amount, raw_json, symbol, underlying_symbol,
        option_expiration, option_right, option_strike, instruction, position_effect,
        quantity, asset_type, price
      FROM broker_transactions
      WHERE UPPER(COALESCE(transaction_type, 'TRADE')) = 'TRADE'
      ORDER BY trade_date ASC, id ASC
    `,
    )
    .all() as Array<{
    id: string;
    account_id: string;
    trade_date: string;
    net_amount: number | null;
    raw_json: string;
    symbol: string | null;
    underlying_symbol: string | null;
    option_expiration: string | null;
    option_right: string | null;
    option_strike: number | null;
    instruction: string | null;
    position_effect: string | null;
    quantity: number | null;
    asset_type: string | null;
    price: number | null;
  }>;

  const out: LinkableTxn[] = [];
  for (const r of rows) {
    const legs = legsFromRawJson(r.raw_json, {
      symbol: r.symbol,
      underlying: r.underlying_symbol,
      expiration: r.option_expiration,
      right: r.option_right,
      strike: r.option_strike,
      instruction: r.instruction,
      positionEffect: r.position_effect,
      quantity: r.quantity,
    });
    if (!legs.length) continue;
    if ((r.asset_type ?? "").toUpperCase() === "EQUITY" && legs.every((l) => !l.right && !l.expiration)) continue;
    out.push({
      id: r.id,
      accountId: r.account_id,
      tradeDate: r.trade_date,
      netAmount: r.net_amount,
      legs,
      orderId: orderIdFromRaw(r.raw_json),
      tradeTime: tradeTimeFromRaw(r.raw_json),
      price: r.price,
      sourceTransactionIds: [r.id],
    });
  }
  return out;
}

function clumpGroupKey(txn: LinkableTxn): string | null {
  const orderId = (txn.orderId ?? "").trim();
  if (!orderId) return null;
  const leg = txn.legs.find((l) => l.right != null || l.expiration != null || l.symbol) ?? txn.legs[0];
  if (!leg) return null;
  const symbol = (leg.symbol ?? "").trim();
  if (!symbol) return null;
  // Opening vs closing — keep put/call of same order separate by symbol already.
  const side = leg.opening ? "open" : "close";
  return `${txn.accountId}|${orderId}|${symbol}|${side}`;
}

function absQty(q: number | null | undefined): number {
  return q != null && Number.isFinite(q) ? Math.abs(q) : 0;
}

function txnSortKey(a: LinkableTxn, b: LinkableTxn): number {
  const d = a.tradeDate.localeCompare(b.tradeDate);
  if (d) return d;
  const ta = a.tradeTime ? Date.parse(a.tradeTime) : Number.POSITIVE_INFINITY;
  const tb = b.tradeTime ? Date.parse(b.tradeTime) : Number.POSITIVE_INFINITY;
  if (ta !== tb) return ta - tb;
  return a.id.localeCompare(b.id);
}

/**
 * Merge Schwab partial fills that share orderId + OCC symbol + open/close
 * into one in-memory linkable txn so proposeSituations sees net lot size (e.g. 20 not 3+17).
 * sourceTransactionIds retains every real broker_transaction id for FK-safe persist.
 */
export function clumpLinkablePartials(txns: LinkableTxn[]): LinkableTxn[] {
  if (txns.length <= 1) return txns.map((t) => ({
    ...t,
    sourceTransactionIds: t.sourceTransactionIds?.length ? t.sourceTransactionIds : [t.id],
  }));

  const buckets = new Map<string, LinkableTxn[]>();
  const solo: LinkableTxn[] = [];
  const order: string[] = [];

  for (const t of txns) {
    const key = clumpGroupKey(t);
    if (!key) {
      solo.push({
        ...t,
        sourceTransactionIds: t.sourceTransactionIds?.length ? t.sourceTransactionIds : [t.id],
      });
      continue;
    }
    if (!buckets.has(key)) {
      buckets.set(key, []);
      order.push(key);
    }
    buckets.get(key)!.push(t);
  }

  const clumped: LinkableTxn[] = order.map((key) => {
    const group = buckets.get(key)!;
    if (group.length === 1) {
      const only = group[0]!;
      return {
        ...only,
        sourceTransactionIds: only.sourceTransactionIds?.length ? only.sourceTransactionIds : [only.id],
      };
    }

    const sorted = [...group].sort(txnSortKey);
    const first = sorted[0]!;
    const sourceIds: string[] = [];
    let netSum = 0;
    let sawNet = false;
    let pxNum = 0;
    let pxDen = 0;

    // Merge leg quantities by symbol (typically one leg per fill row).
    const legBySymbol = new Map<string, LinkableLeg>();
    for (const t of sorted) {
      for (const sid of t.sourceTransactionIds?.length ? t.sourceTransactionIds : [t.id]) {
        if (!sourceIds.includes(sid)) sourceIds.push(sid);
      }
      if (t.netAmount != null && Number.isFinite(t.netAmount)) {
        netSum += t.netAmount;
        sawNet = true;
      }
      const w = absQty(t.legs[0]?.quantity ?? null);
      if (t.price != null && Number.isFinite(t.price) && w > 0) {
        pxNum += w * t.price;
        pxDen += w;
      }
      for (const leg of t.legs) {
        const sym = (leg.symbol ?? "").trim();
        const prev = legBySymbol.get(sym);
        if (!prev) {
          legBySymbol.set(sym, { ...leg });
          continue;
        }
        const q0 = prev.quantity;
        const q1 = leg.quantity;
        const mergedQty =
          q0 != null && Number.isFinite(q0) && q1 != null && Number.isFinite(q1)
            ? q0 + q1
            : q0 ?? q1;
        legBySymbol.set(sym, { ...prev, quantity: mergedQty });
      }
    }

    const vwap = pxDen > 0 ? Math.round((pxNum / pxDen) * 1e6) / 1e6 : first.price ?? null;

    return {
      id: first.id,
      accountId: first.accountId,
      tradeDate: first.tradeDate,
      tradeTime: first.tradeTime ?? null,
      orderId: first.orderId ?? null,
      price: vwap,
      netAmount: sawNet ? Math.round(netSum * 100) / 100 : first.netAmount,
      legs: [...legBySymbol.values()],
      sourceTransactionIds: sourceIds,
    };
  });

  return [...clumped, ...solo].sort(txnSortKey);
}

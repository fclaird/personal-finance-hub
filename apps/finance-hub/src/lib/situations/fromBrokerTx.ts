import type Database from "better-sqlite3";

import type { SchwabTxnRaw } from "@/lib/schwab/transactionNormalize";
import { securityLegsOf } from "@/lib/schwab/transactionNormalize";
import { instructionKind, parseOptionFromSchwabSymbol, positionIsOpening } from "@/lib/strategy/optionParse";
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
      const inst = instructionKind(leg.instruction ?? null);
      const putCall = (leg.instrument?.putCall ?? "").toUpperCase();
      return {
        symbol: (leg.instrument?.symbol ?? parsed?.underlying ?? "").trim(),
        underlying: (leg.instrument?.underlyingSymbol ?? parsed?.underlying ?? "").trim().toUpperCase(),
        expiration: parsed?.expiration ?? null,
        right: parsed?.right ?? (putCall.startsWith("P") ? "P" : putCall.startsWith("C") ? "C" : null),
        strike: parsed?.strike ?? (typeof leg.instrument?.strikePrice === "number" ? leg.instrument.strikePrice : null),
        instruction: inst,
        opening: positionIsOpening(leg.positionEffect ?? null, inst),
        quantity: typeof leg.quantity === "number" ? leg.quantity : typeof leg.amount === "number" ? leg.amount : null,
      };
    });
  }
  if (!fallback) return [];
  const parsed = parseOptionFromSchwabSymbol(fallback.symbol);
  const inst = instructionKind(fallback.instruction ?? null);
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

export function loadLinkableBrokerTransactions(db: Database.Database): LinkableTxn[] {
  const rows = db
    .prepare(
      `
      SELECT
        id, account_id, trade_date, net_amount, raw_json, symbol, underlying_symbol,
        option_expiration, option_right, option_strike, instruction, position_effect,
        quantity, asset_type
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
    });
  }
  return out;
}

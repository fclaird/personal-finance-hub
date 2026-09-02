import type Database from "better-sqlite3";

import type { SchwabTxnItem, SchwabTxnRaw } from "@/lib/schwab/transactionNormalize";
import { normalizeSchwabTransaction, securityLegsOf, tradeDateIso } from "@/lib/schwab/transactionNormalize";
import { hasCoveringShares } from "@/lib/strategy/equityCoverage";
import {
  EARNINGS_WINDOW_DAYS,
  LEAP_MIN_DTE,
  instructionKind,
  optionDte,
  parseOptionFromSchwabSymbol,
  positionIsOpening,
  type InstructionKind,
} from "@/lib/strategy/optionParse";
import { detectOptionStructure, type OptionLegView } from "@/lib/strategy/optionStructures";
import { isStrategySlug, type StrategySlug } from "@/lib/strategy/strategyCategories";

export function earningsExpirationNearCalendar(
  db: Database.Database,
  underlyingSymbol: string,
  optionExpirationIso: string,
): boolean {
  const u = (underlyingSymbol ?? "").trim().toUpperCase();
  if (!u || !optionExpirationIso) return false;
  const row = db
    .prepare(
      `
      SELECT 1 AS ok
      FROM earnings_events
      WHERE UPPER(symbol) = @u
        AND ABS(julianday(earnings_date) - julianday(@exp)) <= @win
      LIMIT 1
    `,
    )
    .get({ u, exp: optionExpirationIso, win: EARNINGS_WINDOW_DAYS }) as { ok: number } | undefined;
  return Boolean(row);
}

function legView(leg: SchwabTxnItem): OptionLegView {
  const inst = instructionKind(leg.instruction ?? null);
  const opening = positionIsOpening(leg.positionEffect?.toUpperCase() ?? null, inst);
  const parsed = parseOptionFromSchwabSymbol(leg.instrument?.symbol);
  const putCall = (leg.instrument?.putCall ?? "").toUpperCase();
  const right = parsed?.right ?? (putCall.startsWith("P") ? "P" : putCall.startsWith("C") ? "C" : null);
  return {
    right,
    strike: parsed?.strike ?? (typeof leg.instrument?.strikePrice === "number" ? leg.instrument.strikePrice : null),
    expiration: parsed?.expiration ?? null,
    instruction: inst,
    opening,
    quantity: typeof leg.quantity === "number" ? leg.quantity : typeof leg.amount === "number" ? leg.amount : null,
  };
}

function classifySingleOption(params: {
  db: Database.Database;
  accountId: string | null;
  tradeDate: string;
  inst: InstructionKind;
  opening: boolean;
  right: "C" | "P" | null;
  expiration: string | null;
  underlying: string;
  quantity: number;
}): StrategySlug {
  const { db, accountId, tradeDate, inst, opening, right, expiration, underlying, quantity } = params;
  const dte = expiration ? optionDte(tradeDate, expiration) : null;

  if (opening && inst === "sell_open" && right === "C") {
    if (expiration && underlying && earningsExpirationNearCalendar(db, underlying, expiration)) return "earnings";
    const contracts = Math.abs(quantity) || 1;
    if (hasCoveringShares(db, accountId, underlying, contracts, tradeDate)) return "covered-calls";
    return "naked-calls";
  }
  if (opening && inst === "sell_open" && right === "P") return "options-sales";

  if (opening && inst === "buy_open") {
    if (dte != null && dte >= LEAP_MIN_DTE) return "leaps";
    if (right === "P") return "long-puts";
    return "long-calls";
  }

  return "uncategorized";
}

export type ClassifyOpts = { accountId?: string | null };

export function classifySchwabTradeRaw(db: Database.Database, raw: SchwabTxnRaw, opts?: ClassifyOpts): StrategySlug {
  const norm = normalizeSchwabTransaction(raw);
  const tradeDate = norm?.trade_date ?? tradeDateIso(raw) ?? null;
  if (!tradeDate) return "uncategorized";

  const type = (raw.type ?? "").toUpperCase();
  if (type && type !== "TRADE") return "uncategorized";

  const items = securityLegsOf(raw);
  if (items.length === 0) return "uncategorized";

  const accountId = opts?.accountId ?? null;
  const optionItems = items.filter((leg) => (leg.instrument?.assetType ?? "").toUpperCase() === "OPTION");

  if (optionItems.length > 1) {
    const views = optionItems.map(legView);
    const structure = detectOptionStructure(views);
    if (structure === "butterfly") return "butterflies";
    if (structure === "short-strangle") return "short-strangles";
    if (structure === "long-strangle") return "spreads";
    if (structure === "spread") return "spreads";
  }

  const leg = (optionItems[0] ?? items[0])!;
  const asset = (leg.instrument?.assetType ?? "").toUpperCase();
  const inst = instructionKind(leg.instruction ?? null);
  const opening = positionIsOpening(leg.positionEffect?.toUpperCase() ?? null, inst);

  if (asset === "EQUITY") {
    if (opening && (inst === "buy_open" || inst === "unknown")) return "buy-and-hold";
    return "uncategorized";
  }

  if (asset === "OPTION") {
    const sym = leg.instrument?.symbol ?? norm?.symbol;
    const parsed = parseOptionFromSchwabSymbol(sym);
    const und = (
      leg.instrument?.underlyingSymbol ??
      parsed?.underlying ??
      norm?.underlying_symbol ??
      ""
    )
      .trim()
      .toUpperCase();
    const exp = parsed?.expiration ?? norm?.option_expiration ?? null;
    const right = parsed?.right ?? (norm?.option_right as "C" | "P" | undefined) ?? null;
    const qty = typeof leg.quantity === "number" ? leg.quantity : (norm?.quantity ?? 1);

    return classifySingleOption({
      db,
      accountId,
      tradeDate,
      inst,
      opening,
      right,
      expiration: exp,
      underlying: und,
      quantity: qty ?? 1,
    });
  }

  return "uncategorized";
}

/**
 * Live category for a stored row. Dual-reads legacy buckets so old
 * covered-calls / options-sales / spreads labels are not shown as-is when
 * the new taxonomy would split them.
 */
export function effectiveStrategyCategory(
  db: Database.Database,
  params: {
    accountId: string;
    rawJson: string;
    storedCategory: string | null;
  },
): StrategySlug {
  let raw: SchwabTxnRaw;
  try {
    raw = JSON.parse(params.rawJson) as SchwabTxnRaw;
  } catch {
    const stored = params.storedCategory;
    return stored && isStrategySlug(stored) ? stored : "uncategorized";
  }
  const live = classifySchwabTradeRaw(db, raw, { accountId: params.accountId });
  const stored = params.storedCategory;
  if (!stored || !isStrategySlug(stored)) return live;

  if (stored === "covered-calls" && live === "naked-calls") return "naked-calls";
  if (stored === "options-sales" && (live === "long-calls" || live === "long-puts" || live === "leaps")) return live;
  if (stored === "spreads" && (live === "short-strangles" || live === "butterflies")) return live;
  if (stored === live) return live;
  // After a reclassify write, stored should already match. Prefer stored when
  // it is a post-split slug so user-facing tabs stay stable.
  const postSplit = [
    "naked-calls",
    "short-strangles",
    "butterflies",
    "long-calls",
    "long-puts",
  ] as const;
  if ((postSplit as readonly string[]).includes(stored)) return stored;
  return live;
}

export function reclassifyBrokerTransactionRow(db: Database.Database, id: string): StrategySlug {
  const row = db
    .prepare(`SELECT raw_json, account_id, strategy_category FROM broker_transactions WHERE id = ?`)
    .get(id) as { raw_json: string; account_id: string; strategy_category: string | null } | undefined;
  if (!row) return "uncategorized";
  let raw: SchwabTxnRaw;
  try {
    raw = JSON.parse(row.raw_json) as SchwabTxnRaw;
  } catch {
    return "uncategorized";
  }
  const cat = classifySchwabTradeRaw(db, raw, { accountId: row.account_id });
  const now = new Date().toISOString();
  db.prepare(
    `
    UPDATE broker_transactions
    SET strategy_category = @cat,
        strategy_category_original = COALESCE(strategy_category_original, strategy_category, @cat),
        classified_at = @now,
        updated_at = @now
    WHERE id = @id
    `,
  ).run({ cat, now, id });
  return cat;
}

export function reclassifyAllBrokerTransactions(db: Database.Database, sinceIsoDate: string | null): number {
  const rows = sinceIsoDate
    ? (db.prepare(`SELECT id FROM broker_transactions WHERE trade_date >= ?`).all(sinceIsoDate) as { id: string }[])
    : (db.prepare(`SELECT id FROM broker_transactions`).all() as { id: string }[]);
  let n = 0;
  for (const r of rows) {
    reclassifyBrokerTransactionRow(db, r.id);
    n++;
  }
  return n;
}

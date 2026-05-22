import type Database from "better-sqlite3";

import type { SchwabTxnRaw } from "@/lib/schwab/transactionNormalize";
import { itemsOf, normalizeSchwabTransaction, tradeDateIso } from "@/lib/schwab/transactionNormalize";
import type { StrategySlug } from "@/lib/strategy/strategyCategories";

const LEAP_MIN_DTE = 365;
const EARNINGS_WINDOW_DAYS = 5;

function daysBetween(isoA: string, isoB: string): number | null {
  const a = new Date(`${isoA}T12:00:00Z`).getTime();
  const b = new Date(`${isoB}T12:00:00Z`).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.abs(Math.round((a - b) / (24 * 3600 * 1000)));
}

function optionDte(tradeDateIso: string, expirationIso: string | null): number | null {
  if (!expirationIso) return null;
  const d = daysBetween(tradeDateIso, expirationIso);
  if (d == null) return null;
  return d;
}

function parseOptionFromSchwabSymbol(symbol: string | null | undefined): {
  expiration: string;
  right: "C" | "P";
  strike: number;
} | null {
  if (!symbol) return null;
  const s = symbol.replace(/\s+/g, " ").trim();
  const m = s.match(/([0-9]{6})([CP])([0-9]{8})$/);
  if (!m) return null;
  const yy = Number(m[1]!.slice(0, 2));
  const mm = Number(m[1]!.slice(2, 4));
  const dd = Number(m[1]!.slice(4, 6));
  const year = 2000 + yy;
  const expiration = `${year.toString().padStart(4, "0")}-${mm.toString().padStart(2, "0")}-${dd.toString().padStart(2, "0")}`;
  return { expiration, right: m[2] === "C" ? "C" : "P", strike: Number(m[3]!) / 1000 };
}

function instructionKind(inst: string | null): "buy_open" | "buy_close" | "sell_open" | "sell_close" | "unknown" {
  if (!inst) return "unknown";
  const u = inst.toUpperCase();
  if (u.includes("BUY_TO_OPEN") || u === "BUY") return "buy_open";
  if (u.includes("BUY_TO_CLOSE")) return "buy_close";
  if (u.includes("SELL_TO_OPEN") || (u.includes("SELL") && u.includes("OPEN"))) return "sell_open";
  if (u.includes("SELL_TO_CLOSE") || (u.includes("SELL") && u.includes("CLOSE"))) return "sell_close";
  if (u === "SELL") return "sell_open";
  if (u === "BUY") return "buy_open";
  return "unknown";
}

function positionIsOpening(effect: string | null, instKind: ReturnType<typeof instructionKind>): boolean {
  if (effect === "OPENING") return true;
  if (effect === "CLOSING") return false;
  return instKind === "buy_open" || instKind === "sell_open";
}

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

export function classifySchwabTradeRaw(db: Database.Database, raw: SchwabTxnRaw): StrategySlug {
  const norm = normalizeSchwabTransaction(raw);
  const tradeDate = norm?.trade_date ?? tradeDateIso(raw) ?? null;
  if (!tradeDate) return "uncategorized";

  const type = (raw.type ?? "").toUpperCase();
  if (type && type !== "TRADE") return "uncategorized";

  const items = itemsOf(raw);
  if (items.length === 0) return "uncategorized";
  if (items.length > 1) return "spreads";

  const leg = items[0]!;
  const asset = (leg.instrument?.assetType ?? "").toUpperCase();
  const inst = instructionKind(leg.instruction ?? null);
  const opening = positionIsOpening(leg.positionEffect?.toUpperCase() ?? null, inst);

  if (asset === "EQUITY") {
    if (opening && (inst === "buy_open" || inst === "unknown")) return "buy-and-hold";
    return "uncategorized";
  }

  if (asset === "OPTION") {
    const sym = leg.instrument?.symbol ?? norm?.symbol;
    const und = (leg.instrument?.underlyingSymbol ?? norm?.underlying_symbol ?? "").trim().toUpperCase();
    const parsed = parseOptionFromSchwabSymbol(sym);
    const exp = parsed?.expiration ?? norm?.option_expiration ?? null;
    const right = parsed?.right ?? (norm?.option_right as "C" | "P" | undefined) ?? null;
    const dte = exp ? optionDte(tradeDate, exp) : null;

    if (opening && inst === "sell_open" && right === "C") {
      if (exp && und && earningsExpirationNearCalendar(db, und, exp)) return "earnings";
      return "covered-calls";
    }
    if (opening && inst === "sell_open" && right === "P") return "options-sales";

    if (opening && inst === "buy_open" && dte != null && dte >= LEAP_MIN_DTE) return "leaps";
    if (opening && inst === "buy_open") return "options-sales";

    return "uncategorized";
  }

  return "uncategorized";
}

export function reclassifyBrokerTransactionRow(db: Database.Database, id: string): StrategySlug {
  const row = db
    .prepare(`SELECT raw_json FROM broker_transactions WHERE id = ?`)
    .get(id) as { raw_json: string } | undefined;
  if (!row) return "uncategorized";
  let raw: SchwabTxnRaw;
  try {
    raw = JSON.parse(row.raw_json) as SchwabTxnRaw;
  } catch {
    return "uncategorized";
  }
  const cat = classifySchwabTradeRaw(db, raw);
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE broker_transactions SET strategy_category = @cat, classified_at = @now, updated_at = @now WHERE id = @id`,
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

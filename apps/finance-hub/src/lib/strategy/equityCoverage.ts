import type Database from "better-sqlite3";

import { instructionKind } from "@/lib/strategy/optionParse";

/**
 * Long share quantity available to cover short calls.
 * Prefers the latest snapshot on or before `asOfDate` (or the latest snapshot when omitted);
 * falls back to net equity TRADE activity on or before asOfDate.
 * Later share purchases must not cover a historical naked short call.
 */
export function longShareQuantityForUnderlying(
  db: Database.Database,
  accountId: string,
  underlyingSymbol: string,
  asOfDate?: string | null,
): number {
  const u = (underlyingSymbol ?? "").trim().toUpperCase();
  if (!u || !accountId) return 0;
  const asOf = asOfDate?.trim() ? asOfDate.trim().slice(0, 10) : null;

  const snap = db
    .prepare(
      `
      SELECT p.quantity AS qty
      FROM positions p
      JOIN holding_snapshots hs ON hs.id = p.snapshot_id
      JOIN securities s ON s.id = p.security_id
      WHERE hs.account_id = @accountId
        AND s.security_type != 'option'
        AND s.security_type != 'cash'
        AND UPPER(TRIM(s.symbol)) = @u
        AND hs.as_of = (
          SELECT MAX(hs2.as_of) FROM holding_snapshots hs2
          WHERE hs2.account_id = @accountId
            AND (@asOf IS NULL OR substr(hs2.as_of, 1, 10) <= @asOf)
        )
    `,
    )
    .all({ accountId, u, asOf }) as { qty: number }[];
  if (snap.length) {
    const q = snap.reduce((s, r) => s + (Number.isFinite(r.qty) ? r.qty : 0), 0);
    if (q > 0) return q;
  }

  const rows = db
    .prepare(
      `
      SELECT quantity, instruction, trade_date
      FROM broker_transactions
      WHERE account_id = @accountId
        AND UPPER(TRIM(COALESCE(symbol, underlying_symbol, ''))) = @u
        AND UPPER(COALESCE(asset_type, '')) = 'EQUITY'
        AND (@asOf IS NULL OR trade_date <= @asOf)
    `,
    )
    .all({ accountId, u, asOf }) as Array<{
    quantity: number | null;
    instruction: string | null;
    trade_date: string;
  }>;

  let net = 0;
  for (const r of rows) {
    const q = Math.abs(r.quantity ?? 0);
    if (!q) continue;
    const kind = instructionKind(r.instruction);
    if (kind === "buy_open" || kind === "buy_close") net += q;
    else if (kind === "sell_open" || kind === "sell_close") net -= q;
  }
  return net;
}

/** True when long shares cover |shortCallContracts| × 100. */
export function hasCoveringShares(
  db: Database.Database,
  accountId: string | null | undefined,
  underlyingSymbol: string,
  shortCallContracts: number,
  asOfDate?: string | null,
): boolean {
  if (!accountId) return false;
  const need = Math.abs(shortCallContracts) * 100;
  if (!Number.isFinite(need) || need <= 0) return false;
  return longShareQuantityForUnderlying(db, accountId, underlyingSymbol, asOfDate) + 1e-9 >= need;
}

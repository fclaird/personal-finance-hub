import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { flavorFromCookies } from "@/lib/flavorFromCookies";
import { latestSnapshotIds } from "@/lib/holdings/latestSnapshots";
import { assembleBook, type BookPositionInput, type BookTxnInput } from "@/lib/strategyLab/bookCost";

/**
 * Open holdings for the Strategy Lab picker.
 * Local SQLite only: latest positions plus the stored trade ledger. No broker orders.
 */
export async function GET() {
  const flavor = await flavorFromCookies();
  const db = getDb();
  const snaps = latestSnapshotIds(db, "schwab_only", flavor);
  if (snaps.length === 0) return NextResponse.json({ ok: true, legs: [] });

  const positions = db
    .prepare(
      `
      SELECT
        p.id AS id,
        a.id AS accountId,
        a.name AS accountLabel,
        s.symbol AS symbol,
        s.security_type AS securityType,
        us.symbol AS underlyingSymbol,
        s.option_type AS optionType,
        s.expiration_date AS expirationDate,
        s.strike_price AS strikePrice,
        p.quantity AS quantity,
        p.price AS price,
        p.market_value AS marketValue,
        p.metadata_json AS metadataJson
      FROM positions p
      JOIN holding_snapshots hs ON hs.id = p.snapshot_id
      JOIN accounts a ON a.id = hs.account_id
      JOIN securities s ON s.id = p.security_id
      LEFT JOIN securities us ON us.id = s.underlying_security_id
      WHERE p.snapshot_id IN (SELECT value FROM json_each(@snapshots_json))
        AND s.security_type IN ('option', 'equity')
        AND ABS(p.quantity) > 1e-9
    `,
    )
    .all({ snapshots_json: JSON.stringify(snaps) }) as BookPositionInput[];

  const accountIds = [...new Set(positions.map((row) => row.accountId))];
  const txns =
    accountIds.length === 0
      ? []
      : (db
          .prepare(
            `
            SELECT
              account_id AS accountId,
              trade_date AS tradeDate,
              symbol AS symbol,
              underlying_symbol AS underlyingSymbol,
              asset_type AS assetType,
              instruction AS instruction,
              position_effect AS positionEffect,
              quantity AS quantity,
              price AS price,
              option_expiration AS optionExpiration,
              option_right AS optionRight,
              option_strike AS optionStrike
            FROM broker_transactions
            WHERE account_id IN (SELECT value FROM json_each(@accounts_json))
          `,
          )
          .all({ accounts_json: JSON.stringify(accountIds) }) as BookTxnInput[]);

  return NextResponse.json({ ok: true, legs: assembleBook(positions, txns) });
}

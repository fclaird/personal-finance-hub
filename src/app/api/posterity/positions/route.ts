import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { isPosterityAccountId, POSTERITY_ACCOUNT_IDS } from "@/lib/posterity";

function normId(s: string) {
  return (s ?? "").trim();
}

export async function GET(req: Request) {
  try {
  const url = new URL(req.url);
  const accountId = normId(url.searchParams.get("accountId") ?? "");
  if (!accountId) return NextResponse.json({ ok: false, error: "Missing accountId" }, { status: 400 });
  if (!isPosterityAccountId(accountId)) {
    return NextResponse.json(
      { ok: false, error: `Invalid posterity accountId. Expected one of: ${POSTERITY_ACCOUNT_IDS.join(", ")}` },
      { status: 400 },
    );
  }

  const db = getDb();
  const snap = db
    .prepare(
      `
      SELECT hs.id AS snapshot_id
      FROM holding_snapshots hs
      WHERE hs.account_id = ?
        AND hs.as_of = (SELECT MAX(hs2.as_of) FROM holding_snapshots hs2 WHERE hs2.account_id = hs.account_id)
      LIMIT 1
    `,
    )
    .get(accountId) as { snapshot_id: string } | undefined;

  const snapshotId = snap?.snapshot_id ?? null;
  if (!snapshotId) return NextResponse.json({ ok: true, accountId, snapshotId: null, positions: [] });

  const rows = db
    .prepare(
      `
      SELECT
        p.id AS positionId,
        p.snapshot_id AS snapshotId,
        a.id AS accountId,
        a.name AS accountName,
        a.nickname AS accountNickname,
        s.security_type AS securityType,
        s.symbol AS symbol,
        us.symbol AS underlyingSymbol,
        s.option_type AS optionType,
        s.expiration_date AS expirationDate,
        s.strike_price AS strikePrice,
        p.quantity AS quantity,
        p.price AS averagePrice,
        p.market_value AS marketValue,
        p.metadata_json AS metadataJson,
        og.delta AS delta,
        og.gamma AS gamma,
        og.theta AS theta,
        og.vega AS vega,
        og.iv AS iv,
        og.updated_at AS greeksUpdatedAt
      FROM positions p
      JOIN holding_snapshots hs ON hs.id = p.snapshot_id
      JOIN accounts a ON a.id = hs.account_id
      JOIN securities s ON s.id = p.security_id
      LEFT JOIN securities us ON us.id = s.underlying_security_id
      LEFT JOIN option_greeks og ON og.position_id = p.id
      WHERE p.snapshot_id = ?
        AND s.security_type != 'cash'
      ORDER BY
        COALESCE(UPPER(us.symbol), UPPER(s.symbol), 'UNKNOWN') ASC,
        CASE WHEN s.security_type = 'option' THEN 1 ELSE 0 END ASC,
        UPPER(COALESCE(s.symbol, '')) ASC
    `,
    )
    .all(snapshotId);

  return NextResponse.json({ ok: true, accountId, snapshotId, positions: rows });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}


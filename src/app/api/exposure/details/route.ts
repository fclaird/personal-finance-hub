import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { getDb } from "@/lib/db";
import { DATA_MODE_COOKIE, parseDataMode } from "@/lib/dataMode";
import { portfolioImpliedEquityPrice } from "@/lib/analytics/optionsExposure";
import { normalizeOptionUnderlying } from "@/lib/options/optionUnderlying";
import { notPosterityWhereSql } from "@/lib/posterity";

function normSym(s: string) {
  return (s ?? "").trim().toUpperCase();
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const underlying = normSym(url.searchParams.get("underlying") ?? "");
  if (!underlying) return NextResponse.json({ ok: false, error: "Missing underlying" }, { status: 400 });

  const jar = await cookies();
  const mode = parseDataMode(jar.get(DATA_MODE_COOKIE)?.value);

  const db = getDb();
  const impliedPrice =
    underlying === "CASH" ? 1 : portfolioImpliedEquityPrice(db, mode, underlying);

  const where =
    mode === "schwab"
      ? `a.id LIKE 'schwab_%' AND ${notPosterityWhereSql("a")}`
      : `a.id NOT LIKE 'demo_%' AND ${notPosterityWhereSql("a")}`;

  const snaps = db
    .prepare(
      `
      SELECT hs.id AS snapshot_id
      FROM accounts a
      JOIN holding_snapshots hs ON hs.account_id = a.id
      WHERE ${where}
        AND hs.as_of = (
          SELECT MAX(hs2.as_of) FROM holding_snapshots hs2 WHERE hs2.account_id = a.id
        )
    `,
    )
    .all() as Array<{ snapshot_id: string }>;
  const snapshotIds = snaps.map((r) => r.snapshot_id);
  if (snapshotIds.length === 0) {
    return NextResponse.json({ ok: true, underlying, impliedPrice, contributors: [] });
  }

  const opts = db
    .prepare(
      `
      SELECT
        p.id AS positionId,
        s.symbol AS optionSymbol,
        us.symbol AS usSymbol,
        p.quantity AS quantity,
        og.delta AS delta
      FROM positions p
      JOIN securities s ON s.id = p.security_id
      LEFT JOIN securities us ON us.id = s.underlying_security_id
      LEFT JOIN option_greeks og ON og.position_id = p.id
      WHERE p.snapshot_id IN (SELECT value FROM json_each(@snaps))
        AND s.security_type = 'option'
    `,
    )
    .all({ snaps: JSON.stringify(snapshotIds) }) as Array<{
    positionId: string;
    optionSymbol: string | null;
    usSymbol: string | null;
    quantity: number;
    delta: number | null;
  }>;

  const matched = opts.filter((r) => normalizeOptionUnderlying(r.usSymbol, r.optionSymbol) === underlying);

  const allContributors = matched
    .map((r) => {
      const d = typeof r.delta === "number" && Number.isFinite(r.delta) ? r.delta : 0;
      const shares = r.quantity * 100 * d;
      return {
        optionSymbol: (r.optionSymbol ?? "").toString(),
        quantity: r.quantity,
        delta: r.delta,
        syntheticShares: shares,
      };
    })
    .filter((c) => c.optionSymbol)
    .sort((a, b) => Math.abs(b.syntheticShares) - Math.abs(a.syntheticShares));

  const syntheticShares = allContributors.reduce((s, c) => s + c.syntheticShares, 0);
  const syntheticMarketValue = impliedPrice != null ? syntheticShares * impliedPrice : null;
  const contributors = allContributors.slice(0, 12);

  return NextResponse.json({
    ok: true,
    underlying,
    impliedPrice,
    syntheticShares,
    syntheticMarketValue,
    contributors,
    snapshots: snapshotIds.length,
  });
}

import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { latestSnapshotIds, latestSnapshotScopeForMode } from "@/lib/holdings/latestSnapshots";
import { POSITION_MARKET_VALUE_SQL } from "@/lib/holdings/positionMarketValue";
import { schwabMarketFetch } from "@/lib/schwab/client";
import { portfolioPctFromMarkedValues, quoteChangePctPoints } from "@/lib/terminal/portfolioDayMove";
import { resolveViewScope } from "@/lib/viewScope";

function normSym(s: string) {
  return (s ?? "").trim().toUpperCase();
}

export async function GET() {
  const { flavor, dataMode: mode } = await resolveViewScope();
  const db = getDb();
  const snapshotIds = latestSnapshotIds(db, latestSnapshotScopeForMode(mode), flavor);
  if (snapshotIds.length === 0) {
    return NextResponse.json({ ok: true, snapshotId: null, portfolioPct: null, SPY: null, QQQ: null });
  }

  const rows = db
    .prepare(
      `
      SELECT s.symbol AS symbol, SUM(${POSITION_MARKET_VALUE_SQL}) AS mv
      FROM positions p
      JOIN securities s ON s.id = p.security_id
      WHERE p.snapshot_id IN (SELECT value FROM json_each(@snaps))
        AND s.security_type != 'cash'
        AND s.symbol IS NOT NULL
      GROUP BY s.symbol
    `,
    )
    .all({ snaps: JSON.stringify(snapshotIds) }) as Array<{ symbol: string; mv: number }>;

  const mvBySym = new Map<string, number>();
  for (const r of rows) {
    const sym = normSym(r.symbol);
    if (!sym || sym === "CASH") continue;
    const mv = r.mv;
    if (!Number.isFinite(mv) || mv === 0) continue;
    mvBySym.set(sym, (mvBySym.get(sym) ?? 0) + mv);
  }

  const symbols = Array.from(new Set([...mvBySym.keys(), "SPY", "QQQ"]));
  if (symbols.length === 0) {
    return NextResponse.json({ ok: true, snapshotId: snapshotIds[0] ?? null, portfolioPct: null, SPY: null, QQQ: null });
  }

  const resp = await schwabMarketFetch<Record<string, unknown>>(`/quotes?symbols=${encodeURIComponent(symbols.join(","))}`);

  const portfolioPct = portfolioPctFromMarkedValues(
    [...mvBySym.entries()].map(([symbol, marketValue]) => ({
      marketValue,
      changePctPoints: quoteChangePctPoints(resp, symbol),
    })),
  );

  const SPY = quoteChangePctPoints(resp, "SPY");
  const QQQ = quoteChangePctPoints(resp, "QQQ");

  return NextResponse.json({ ok: true, snapshotId: snapshotIds[0] ?? null, portfolioPct, SPY, QQQ, snapshots: snapshotIds.length });
}


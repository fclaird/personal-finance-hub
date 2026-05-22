import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { latestSnapshotId } from "@/lib/snapshots";
import { schwabMarketFetch } from "@/lib/schwab/client";
import { schwabQuoteObjectFromEntry } from "@/lib/schwab/quoteEntry";
import { notPosterityWhereSql } from "@/lib/posterity";

function normSym(s: string) {
  return (s ?? "").trim().toUpperCase();
}

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function quoteChangePctFromResp(resp: Record<string, unknown>, sym: string): number | null {
  const entry = resp[sym] ?? resp[sym.toUpperCase()];
  const q = schwabQuoteObjectFromEntry(entry);
  if (!q) return null;
  const last = asNumber(q.lastPrice) ?? null;
  const close = asNumber(q.closePrice) ?? null;
  const change =
    asNumber(q.netChange ?? q.change) ?? (last != null && close != null ? last - close : null);
  const changePercent =
    asNumber(q.netPercentChangeInDouble ?? q.changePercent) ??
    (change != null && close != null && close !== 0 ? change / close : null);
  return changePercent == null ? null : changePercent * 100;
}

export async function GET() {
  const db = getDb();
  const snaps = (db
    .prepare(
      `
      SELECT hs.id AS snapshot_id
      FROM holding_snapshots hs
      JOIN accounts a ON a.id = hs.account_id
      WHERE a.id LIKE 'schwab_%'
        AND ${notPosterityWhereSql("a")}
        AND hs.as_of = (
          SELECT MAX(hs2.as_of) FROM holding_snapshots hs2 WHERE hs2.account_id = a.id
        )
      ORDER BY a.name ASC
    `,
    )
    .all() as Array<{ snapshot_id: string }>)
    .map((r) => r.snapshot_id);

  const snapFallback = latestSnapshotId(db);
  const snapshotIds = snaps.length ? snaps : snapFallback ? [snapFallback] : [];
  if (snapshotIds.length === 0) {
    return NextResponse.json({ ok: true, snapshotId: null, portfolioPct: null, SPY: null, QQQ: null });
  }

  const rows = db
    .prepare(
      `
      SELECT s.symbol AS symbol, SUM(COALESCE(p.market_value, 0)) AS mv
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

  let cur = 0;
  let prev = 0;
  for (const [sym, mv] of mvBySym.entries()) {
    const pct = quoteChangePctFromResp(resp, sym);
    if (pct == null || !Number.isFinite(pct)) continue;
    cur += mv;
    prev += mv / (1 + pct / 100);
  }
  const portfolioPct = prev > 0 ? (cur / prev - 1) * 100 : null;

  const SPY = quoteChangePctFromResp(resp, "SPY");
  const QQQ = quoteChangePctFromResp(resp, "QQQ");

  return NextResponse.json({ ok: true, snapshotId: snapshotIds[0] ?? null, portfolioPct, SPY, QQQ, snapshots: snapshotIds.length });
}


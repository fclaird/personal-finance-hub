import type Database from "better-sqlite3";

import type { FlavorId } from "@/lib/flavor";
import { latestSnapshotIds } from "@/lib/holdings/latestSnapshots";
import { POSITION_MARKET_VALUE_SQL } from "@/lib/holdings/positionMarketValue";
import { schwabQuoteObjectFromEntry } from "@/lib/schwab/quoteEntry";
import { fetchSchwabQuotesResponse } from "@/lib/schwab/quotesFetch";
import type { PortfolioChangeCaption } from "@/lib/terminal/portfolioChangeCaption";
import { portfolioDailyReturnPct } from "@/lib/terminal/portfolioCashFlows";

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function normSym(s: string) {
  return (s ?? "").trim().toUpperCase();
}

export function quoteChangePctPoints(resp: Record<string, unknown>, sym: string): number | null {
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

export function portfolioPctFromMarkedValues(
  rows: Array<{ marketValue: number; changePctPoints: number | null }>,
): number | null {
  let cur = 0;
  let prev = 0;
  for (const row of rows) {
    const pct = row.changePctPoints;
    const mv = row.marketValue;
    if (pct == null || !Number.isFinite(pct) || !Number.isFinite(mv) || mv === 0) continue;
    const denom = 1 + pct / 100;
    if (!(denom > 0) || !Number.isFinite(denom)) continue;
    cur += mv;
    prev += mv / denom;
  }
  if (!(prev > 0)) return null;
  return (cur / prev - 1) * 100;
}

export type PortfolioDayPresentation = {
  caption: PortfolioChangeCaption;
  changePct: number | null;
  priorNetValue: number;
};

export function presentPortfolioDayChange(args: {
  netValue: number;
  priorNetValue: number;
  netCashFlow: number;
  sessionYmd: string;
  quotePortfolioPct: number | null;
  baseline: { status: "prior_session" } | { status: "stale"; staleBaselineYmd: string };
}): PortfolioDayPresentation {
  const quote = args.quotePortfolioPct;
  if (args.baseline.status === "stale" && quote != null && Number.isFinite(quote)) {
    const prior = args.netValue / (1 + quote / 100);
    if (prior > 0 && Number.isFinite(prior)) {
      return { caption: { kind: "day" }, changePct: quote, priorNetValue: prior };
    }
  }

  if (args.baseline.status === "stale") {
    return {
      caption: { kind: "since", baselineYmd: args.baseline.staleBaselineYmd, sessionYmd: args.sessionYmd },
      changePct: portfolioDailyReturnPct(args.netValue, args.priorNetValue, args.netCashFlow),
      priorNetValue: args.priorNetValue,
    };
  }

  return {
    caption: { kind: "day" },
    changePct: portfolioDailyReturnPct(args.netValue, args.priorNetValue, args.netCashFlow),
    priorNetValue: args.priorNetValue,
  };
}

export async function loadPortfolioQuoteDayPct(db: Database.Database, flavor: FlavorId): Promise<number | null> {
  try {
    const snapshotIds = latestSnapshotIds(db, "all_synced", flavor);
    if (snapshotIds.length === 0) return null;
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
    for (const row of rows) {
      const sym = normSym(row.symbol);
      if (!sym || sym === "CASH") continue;
      if (!Number.isFinite(row.mv) || row.mv === 0) continue;
      mvBySym.set(sym, (mvBySym.get(sym) ?? 0) + row.mv);
    }
    if (mvBySym.size === 0) return null;

    const resp = await fetchSchwabQuotesResponse([...mvBySym.keys()]);
    return portfolioPctFromMarkedValues(
      [...mvBySym.entries()].map(([symbol, marketValue]) => ({
        marketValue,
        changePctPoints: quoteChangePctPoints(resp, symbol),
      })),
    );
  } catch {
    return null;
  }
}

import { getDb } from "@/lib/db";
import type { DataMode } from "@/lib/dataMode";
import { bucketFromAccount } from "@/lib/accountBuckets";
import { notPosterityWhereSql } from "@/lib/posterity";

export type PortfolioValuePoint = {
  asOf: string;
  totalMarketValue: number;
};

export function getPortfolioValueSeries(mode: DataMode = "auto"): PortfolioValuePoint[] {
  const db = getDb();
  const where = mode === "schwab" ? "WHERE a.id LIKE 'schwab_%'" : "";

  if (mode === "schwab") {
    const av = db
      .prepare(
        `
        SELECT av.as_of AS as_of, SUM(av.equity_value) AS mv
        FROM account_value_points av
        JOIN accounts a ON a.id = av.account_id
        WHERE a.id LIKE 'schwab_%'
          AND ${notPosterityWhereSql("a")}
        GROUP BY av.as_of
        ORDER BY av.as_of ASC
      `,
      )
      .all() as Array<{ as_of: string; mv: number }>;
    if (av.length > 0) return av.map((r) => ({ asOf: r.as_of, totalMarketValue: r.mv }));
  }

  // Each sync creates per-account snapshots; roll those into a single timestamped portfolio value.
  const rows = db
    .prepare(
      `
      SELECT hs.as_of AS as_of, SUM(COALESCE(p.market_value, 0)) AS mv
      FROM holding_snapshots hs
      JOIN accounts a ON a.id = hs.account_id
      JOIN positions p ON p.snapshot_id = hs.id
      JOIN securities s ON s.id = p.security_id
      ${where}
        ${where ? "AND" : "WHERE"} ${where ? notPosterityWhereSql("a") + " AND" : notPosterityWhereSql("a") + " AND"} s.security_type != 'cash'
      GROUP BY hs.as_of
      ORDER BY hs.as_of ASC
    `,
    )
    .all() as Array<{ as_of: string; mv: number }>;

  return rows.map((r) => ({ asOf: r.as_of, totalMarketValue: r.mv }));
}

type BucketKey = "combined" | "retirement" | "brokerage";

export function getPortfolioValueSeriesByBucket(bucket: BucketKey, mode: DataMode = "auto"): PortfolioValuePoint[] {
  const db = getDb();
  if (bucket === "combined") return getPortfolioValueSeries(mode);

  const where = mode === "schwab" ? "WHERE a.id LIKE 'schwab_%'" : "";

  if (mode === "schwab") {
    const map = new Map<string, number>();
    const pts = db
      .prepare(
        `
        SELECT av.as_of as as_of, a.name as account_name, a.nickname as account_nickname, av.equity_value as mv
        FROM account_value_points av
        JOIN accounts a ON a.id = av.account_id
        WHERE a.id LIKE 'schwab_%'
          AND ${notPosterityWhereSql("a")}
        ORDER BY av.as_of ASC
      `,
      )
      .all() as Array<{ as_of: string; account_name: string; account_nickname: string | null; mv: number }>;
    if (pts.length > 0) {
      for (const r of pts) {
        const b = bucketFromAccount(r.account_name, r.account_nickname);
        if (b !== bucket) continue;
        map.set(r.as_of, (map.get(r.as_of) ?? 0) + r.mv);
      }
      return Array.from(map.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([asOf, totalMarketValue]) => ({ asOf, totalMarketValue }));
    }
  }

  // That query groups by as_of and type; we need to aggregate into bucket per timestamp.
  const map = new Map<string, number>();
  const snaps = db
    .prepare(
      `
      SELECT hs.as_of as as_of, a.name as account_name, a.nickname as account_nickname, SUM(COALESCE(p.market_value, 0)) AS mv
      FROM holding_snapshots hs
      JOIN accounts a ON a.id = hs.account_id
      JOIN positions p ON p.snapshot_id = hs.id
      JOIN securities s ON s.id = p.security_id
      ${where}
        ${where ? "AND" : "WHERE"} ${notPosterityWhereSql("a")} AND s.security_type != 'cash'
      GROUP BY hs.as_of, a.id
      ORDER BY hs.as_of ASC
    `,
    )
    .all() as Array<{ as_of: string; account_name: string; account_nickname: string | null; mv: number }>;

  for (const r of snaps) {
    const b = bucketFromAccount(r.account_name, r.account_nickname);
    if (b !== bucket) continue;
    map.set(r.as_of, (map.get(r.as_of) ?? 0) + r.mv);
  }

  return Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([asOf, totalMarketValue]) => ({ asOf, totalMarketValue }));
}


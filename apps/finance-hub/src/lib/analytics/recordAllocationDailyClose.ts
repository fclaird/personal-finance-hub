import type Database from "better-sqlite3";

import type { AnalyticsBucketKey } from "@/lib/accountBuckets";
import { shouldWriteAllocationDailyClose } from "@/lib/analytics/allocationNyDate";
import type { DataMode } from "@/lib/dataMode";
import type { FlavorId } from "@/lib/flavor";
import { getUnderlyingExposureByBucket } from "@/lib/analytics/optionsExposure";

export type AllocationDailyScope = "net" | AnalyticsBucketKey;

function mergeNetFromBuckets(
  db: Database.Database,
  mode: DataMode,
  flavor: FlavorId = "main",
): Map<string, { spot: number; synthetic: number }> {
  const buckets = getUnderlyingExposureByBucket(mode, undefined, flavor, db);
  const net = new Map<string, { spot: number; synthetic: number }>();
  for (const b of buckets) {
    for (const r of b.exposure) {
      const sym = (r.underlyingSymbol ?? "").trim().toUpperCase();
      if (!sym) continue;
      const cur = net.get(sym) ?? { spot: 0, synthetic: 0 };
      cur.spot += r.spotMarketValue;
      cur.synthetic += r.syntheticMarketValue;
      net.set(sym, cur);
    }
  }
  return net;
}

function mapFromBucket(
  db: Database.Database,
  mode: DataMode,
  scope: AnalyticsBucketKey,
  flavor: FlavorId = "main",
): Map<string, { spot: number; synthetic: number }> {
  const buckets = getUnderlyingExposureByBucket(mode, undefined, flavor, db);
  const b = buckets.find((x) => x.bucketKey === scope);
  const m = new Map<string, { spot: number; synthetic: number }>();
  if (!b) return m;
  for (const r of b.exposure) {
    const sym = (r.underlyingSymbol ?? "").trim().toUpperCase();
    if (!sym) continue;
    m.set(sym, { spot: r.spotMarketValue, synthetic: r.syntheticMarketValue });
  }
  return m;
}

/**
 * Snapshot current exposure into allocation_daily_underlying for one NY trade date.
 * Writes only after that date's 16:00 ET cash close, and only once. A later sync
 * (after-hours collapse, or Sunday's book labeled as Friday) does not replace it.
 * The live book is the source; this does not walk older holding snapshots.
 */
export function recordAllocationDailyClose(
  db: Database.Database,
  tradeDateEt: string,
  mode: DataMode,
  flavor: FlavorId = "main",
  now: Date = new Date(),
): { rowsWritten: number } {
  const existing = db
    .prepare(
      `SELECT created_at AS createdAt
       FROM allocation_daily_underlying
       WHERE trade_date = ? AND data_mode = ? AND scope = 'net'
       LIMIT 1`,
    )
    .get(tradeDateEt, mode) as { createdAt: string } | undefined;
  if (!shouldWriteAllocationDailyClose(now, tradeDateEt, existing?.createdAt ?? null)) {
    return { rowsWritten: 0 };
  }

  const scopes: AllocationDailyScope[] = ["net", "brokerage", "retirement", "529"];
  const byScope = new Map<AllocationDailyScope, Map<string, { spot: number; synthetic: number }>>();
  for (const scope of scopes) {
    byScope.set(
      scope,
      scope === "net" ? mergeNetFromBuckets(db, mode, flavor) : mapFromBucket(db, mode, scope, flavor),
    );
  }

  const createdAt = now.toISOString().slice(0, 19).replace("T", " ");
  const upsert = db.prepare(`
    INSERT INTO allocation_daily_underlying (
      trade_date, data_mode, scope, symbol, spot_market_value, synthetic_market_value, created_at
    ) VALUES (
      @trade_date, @data_mode, @scope, @symbol, @spot, @synthetic, @created_at
    )
  `);

  let rowsWritten = 0;
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM allocation_daily_underlying WHERE trade_date = ? AND data_mode = ?`).run(tradeDateEt, mode);
    for (const scope of scopes) {
      const map = byScope.get(scope);
      if (!map) continue;
      for (const [symbol, v] of map.entries()) {
        if (Math.abs(v.spot) < 1e-9 && Math.abs(v.synthetic) < 1e-9) continue;
        upsert.run({
          trade_date: tradeDateEt,
          data_mode: mode,
          scope,
          symbol,
          spot: v.spot,
          synthetic: v.synthetic,
          created_at: createdAt,
        });
        rowsWritten++;
      }
    }
  });
  tx();
  return { rowsWritten };
}

export function recordAllocationDailyCloseModes(
  db: Database.Database,
  tradeDateEt: string,
  modes: readonly DataMode[],
  flavor: FlavorId = "main",
  now: Date = new Date(),
): { rowsWritten: number } {
  let n = 0;
  for (const mode of modes) {
    n += recordAllocationDailyClose(db, tradeDateEt, mode, flavor, now).rowsWritten;
  }
  return { rowsWritten: n };
}

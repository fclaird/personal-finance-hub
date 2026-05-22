import type Database from "better-sqlite3";

import type { DataMode } from "@/lib/dataMode";
import { getUnderlyingExposureByBucket } from "@/lib/analytics/optionsExposure";

export type AllocationDailyScope = "net" | "brokerage" | "retirement";

function mergeNetFromBuckets(mode: DataMode): Map<string, { spot: number; synthetic: number }> {
  const buckets = getUnderlyingExposureByBucket(mode);
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

function mapFromBucket(mode: DataMode, scope: "brokerage" | "retirement"): Map<string, { spot: number; synthetic: number }> {
  const buckets = getUnderlyingExposureByBucket(mode);
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
 * Snapshot current exposure (latest per-account snapshots inside getUnderlyingExposureByBucket)
 * into allocation_daily_underlying for one NY trade_date. Idempotent per (date, mode, scope, symbol).
 * v1: does not walk historical holding_snapshots by as_of; uses live rollup at write time.
 */
export function recordAllocationDailyClose(
  db: Database.Database,
  tradeDateEt: string,
  mode: DataMode,
): { rowsWritten: number } {
  const scopes: AllocationDailyScope[] = ["net", "brokerage", "retirement"];
  const upsert = db.prepare(`
    INSERT INTO allocation_daily_underlying (trade_date, data_mode, scope, symbol, spot_market_value, synthetic_market_value)
    VALUES (@trade_date, @data_mode, @scope, @symbol, @spot, @synthetic)
    ON CONFLICT(trade_date, data_mode, scope, symbol) DO UPDATE SET
      spot_market_value = excluded.spot_market_value,
      synthetic_market_value = excluded.synthetic_market_value,
      created_at = datetime('now')
  `);

  let rowsWritten = 0;
  for (const scope of scopes) {
    const map = scope === "net" ? mergeNetFromBuckets(mode) : mapFromBucket(mode, scope);
    for (const [symbol, v] of map.entries()) {
      if (Math.abs(v.spot) < 1e-9 && Math.abs(v.synthetic) < 1e-9) continue;
      upsert.run({
        trade_date: tradeDateEt,
        data_mode: mode,
        scope,
        symbol,
        spot: v.spot,
        synthetic: v.synthetic,
      });
      rowsWritten++;
    }
  }
  return { rowsWritten };
}

export function recordAllocationDailyCloseModes(
  db: Database.Database,
  tradeDateEt: string,
  modes: readonly DataMode[],
): { rowsWritten: number } {
  let n = 0;
  for (const mode of modes) {
    n += recordAllocationDailyClose(db, tradeDateEt, mode).rowsWritten;
  }
  return { rowsWritten: n };
}

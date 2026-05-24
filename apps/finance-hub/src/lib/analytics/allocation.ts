import { getDb } from "@/lib/db";
import {
  getUnderlyingExposureRollup,
  portfolioImpliedEquityPriceMap,
  syntheticEquityMvForSnapshot,
} from "@/lib/analytics/optionsExposure";
import { classifyAsset, type AssetClass } from "@/lib/analytics/assetClass";
import {
  accountsInDataModeWhereSql,
  latestSnapshotIds,
  latestSnapshotScopeForMode,
} from "@/lib/holdings/latestSnapshots";
import { POSITION_MARKET_VALUE_SQL } from "@/lib/holdings/positionMarketValue";
import type { DataMode } from "@/lib/dataMode";
import type { AnalyticsBucketKey } from "@/lib/accountBuckets";
import { bucketFromAccount } from "@/lib/accountBuckets";

export type AllocationBucket = {
  key: string;
  marketValue: number;
  weight: number;
};

export type AllocationResult = {
  totalMarketValue: number;
  byAssetClass: AllocationBucket[];
};

export type AllocationByAccountRow = {
  accountId: string;
  accountName: string;
  totalMarketValue: number;
  byAssetClass: AllocationBucket[];
};

export type AllocationBucketedResult = {
  includeSynthetic: boolean;
  buckets: Array<{
    bucketKey: AnalyticsBucketKey;
    totalMarketValue: number;
    byAssetClass: AllocationBucket[];
  }>;
};

function classify(securityType: string, metadataJson: string | null): AssetClass {
  return classifyAsset(securityType, metadataJson);
}

export function getConsolidatedAllocation(includeSynthetic: boolean, mode: DataMode = "auto"): AllocationResult {
  const db = getDb();
  const scope = latestSnapshotScopeForMode(mode);
  const snapshotIds = latestSnapshotIds(db, scope);
  if (snapshotIds.length === 0) return { totalMarketValue: 0, byAssetClass: [] };

  const rows = db
    .prepare(
      `
      SELECT a.id AS account_id, s.symbol, s.security_type, ${POSITION_MARKET_VALUE_SQL} AS market_value, p.metadata_json
      FROM positions p
      JOIN holding_snapshots hs ON hs.id = p.snapshot_id
      JOIN accounts a ON a.id = hs.account_id
      JOIN securities s ON s.id = p.security_id
      WHERE p.snapshot_id IN (SELECT value FROM json_each(@snaps))
        AND (s.security_type != 'cash' OR a.id LIKE 'manual_%')
    `,
    )
    .all({ snaps: JSON.stringify(snapshotIds) }) as Array<{
    account_id: string;
    symbol: string | null;
    security_type: string;
    market_value: number | null;
    metadata_json: string | null;
  }>;

  const buckets = new Map<AssetClass, number>();
  for (const r of rows) {
    const mv = r.market_value ?? 0;
    const cls = classify(r.security_type, r.metadata_json);
    // Exclude option market value when synthetic is enabled, since we'll represent it as equity exposure instead.
    if (includeSynthetic && cls === "option") continue;
    buckets.set(cls, (buckets.get(cls) ?? 0) + mv);
  }

  if (includeSynthetic) {
    // Add synthetic option delta exposure into equities bucket.
    const exposures = getUnderlyingExposureRollup(mode);
    const syntheticEquityMv = exposures.reduce((sum, e) => sum + e.syntheticMarketValue, 0);
    buckets.set("equity", (buckets.get("equity") ?? 0) + syntheticEquityMv);
  }

  const total = Array.from(buckets.values()).reduce((a, b) => a + b, 0);
  const byAssetClass: AllocationBucket[] = Array.from(buckets.entries())
    .map(([key, marketValue]) => ({
      key,
      marketValue,
      weight: total ? marketValue / total : 0,
    }))
    .sort((a, b) => b.marketValue - a.marketValue);

  return { totalMarketValue: total, byAssetClass };
}

export function getAllocationByAccount(includeSynthetic: boolean, mode: DataMode = "auto"): AllocationByAccountRow[] {
  const db = getDb();
  const priceByUnderlying = includeSynthetic ? portfolioImpliedEquityPriceMap(db, mode) : undefined;

  // Latest snapshot per account
  const snapshots = db
    .prepare(
      `
      SELECT a.id AS account_id, a.name AS account_name, a.type AS account_type, hs.id AS snapshot_id
      FROM accounts a
      JOIN holding_snapshots hs ON hs.account_id = a.id
      WHERE hs.as_of = (
        SELECT MAX(hs2.as_of) FROM holding_snapshots hs2 WHERE hs2.account_id = a.id
      )
        AND ${accountsInDataModeWhereSql(mode, "a")}
      ORDER BY a.name ASC
    `,
    )
    .all() as Array<{ account_id: string; account_name: string; account_type: string; snapshot_id: string }>;

  const out: AllocationByAccountRow[] = [];

  for (const s of snapshots) {
    const rows = db
      .prepare(
        `
        SELECT s.security_type, ${POSITION_MARKET_VALUE_SQL} AS market_value, p.metadata_json
        FROM positions p
        JOIN securities s ON s.id = p.security_id
        WHERE p.snapshot_id = @snapshot_id
          AND (s.security_type != 'cash' OR @account_id LIKE 'manual_%')
      `,
      )
      .all({ snapshot_id: s.snapshot_id, account_id: s.account_id }) as Array<{
      security_type: string;
      market_value: number | null;
      metadata_json: string | null;
    }>;

    const buckets = new Map<AssetClass, number>();
    for (const r of rows) {
      const mv = r.market_value ?? 0;
      const cls = classify(r.security_type, r.metadata_json);
      if (includeSynthetic && cls === "option") continue;
      buckets.set(cls, (buckets.get(cls) ?? 0) + mv);
    }

    // Per-account synthetic exposure: compute synthetic MV using the same method as consolidated,
    // but scoped to the account's latest snapshot.
    if (includeSynthetic) {
      buckets.set(
        "equity",
        (buckets.get("equity") ?? 0) + syntheticEquityMvForSnapshot(db, s.snapshot_id, mode, priceByUnderlying),
      );
    }

    const total = Array.from(buckets.values()).reduce((a, b) => a + b, 0);
    const byAssetClass: AllocationBucket[] = Array.from(buckets.entries())
      .map(([key, marketValue]) => ({
        key,
        marketValue,
        weight: total ? marketValue / total : 0,
      }))
      .sort((a, b) => b.marketValue - a.marketValue);

    out.push({
      accountId: s.account_id,
      accountName: s.account_name,
      totalMarketValue: total,
      byAssetClass,
    });
  }

  return out;
}

export function getAllocationByBucket(includeSynthetic: boolean, mode: DataMode = "auto"): AllocationBucketedResult {
  const db = getDb();
  const priceByUnderlying = includeSynthetic ? portfolioImpliedEquityPriceMap(db, mode) : undefined;
  const scope = latestSnapshotScopeForMode(mode);
  const snapshotIdSet = new Set(latestSnapshotIds(db, scope));

  const snapshots = db
    .prepare(
      `
      SELECT a.id AS account_id, a.name AS account_name, a.nickname AS account_nickname, a.account_bucket AS account_bucket, hs.id AS snapshot_id
      FROM accounts a
      JOIN holding_snapshots hs ON hs.account_id = a.id
      WHERE hs.as_of = (
        SELECT MAX(hs2.as_of) FROM holding_snapshots hs2 WHERE hs2.account_id = a.id
      )
    `,
    )
    .all() as Array<{ account_id: string; account_name: string; account_nickname: string | null; account_bucket: string | null; snapshot_id: string }>;

  const byBucket = new Map<AnalyticsBucketKey, Map<AssetClass, number>>();

  for (const s of snapshots) {
    if (!snapshotIdSet.has(s.snapshot_id)) continue;
    const bucket = bucketFromAccount(s.account_name, s.account_nickname, s.account_bucket);
    if (!byBucket.has(bucket)) byBucket.set(bucket, new Map());
    const buckets = byBucket.get(bucket)!;

    const rows = db
      .prepare(
        `
        SELECT s.security_type, ${POSITION_MARKET_VALUE_SQL} AS market_value, p.metadata_json
        FROM positions p
        JOIN securities s ON s.id = p.security_id
        WHERE p.snapshot_id = @snapshot_id
          AND (s.security_type != 'cash' OR @account_id LIKE 'manual_%')
      `,
      )
      .all({ snapshot_id: s.snapshot_id, account_id: s.account_id }) as Array<{
      security_type: string;
      market_value: number | null;
      metadata_json: string | null;
    }>;

    for (const r of rows) {
      const mv = r.market_value ?? 0;
      const cls = classify(r.security_type, r.metadata_json);
      if (includeSynthetic && cls === "option") continue;
      buckets.set(cls, (buckets.get(cls) ?? 0) + mv);
    }

    if (includeSynthetic) {
      buckets.set(
        "equity",
        (buckets.get("equity") ?? 0) + syntheticEquityMvForSnapshot(db, s.snapshot_id, mode, priceByUnderlying),
      );
    }
  }

  const outBuckets: AllocationBucketedResult["buckets"] = [];
  for (const [bucketKey, m] of byBucket.entries()) {
    const total = Array.from(m.values()).reduce((a, b) => a + b, 0);
    const byAssetClass: AllocationBucket[] = Array.from(m.entries())
      .map(([key, marketValue]) => ({
        key,
        marketValue,
        weight: total ? marketValue / total : 0,
      }))
      .sort((a, b) => b.marketValue - a.marketValue);
    outBuckets.push({ bucketKey, totalMarketValue: total, byAssetClass });
  }

  const bucketOrder: Record<AnalyticsBucketKey, number> = { retirement: 0, brokerage: 1, "529": 2 };
  outBuckets.sort((a, b) => bucketOrder[a.bucketKey] - bucketOrder[b.bucketKey]);

  return { includeSynthetic, buckets: outBuckets };
}


import { getDb } from "@/lib/db";
import {
  getUnderlyingExposureRollup,
  portfolioImpliedEquityPriceMap,
  syntheticEquityMvForSnapshot,
  EFFECTIVE_OPTION_DELTA_SQL,
} from "@/lib/analytics/optionsExposure";
import { normalizeOptionUnderlying } from "@/lib/options/optionUnderlying";
import { classifyAsset, type AssetClass } from "@/lib/analytics/assetClass";
import {
  accountsInDataModeWhereSql,
  latestSnapshotIds,
  latestSnapshotPerAccountJoinSql,
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

export function getConsolidatedAllocation(
  includeSynthetic: boolean,
  mode: DataMode = "auto",
  equityMarkMap?: Map<string, number>,
): AllocationResult {
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
    const exposures = getUnderlyingExposureRollup(mode, equityMarkMap);
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

export function getAllocationByAccount(
  includeSynthetic: boolean,
  mode: DataMode = "auto",
  equityMarkMap?: Map<string, number>,
): AllocationByAccountRow[] {
  const db = getDb();
  const priceByUnderlying =
    includeSynthetic ? (equityMarkMap ?? portfolioImpliedEquityPriceMap(db, mode)) : undefined;

  const snapshots = db
    .prepare(
      `
      SELECT a.id AS account_id, a.name AS account_name, a.type AS account_type, hs.id AS snapshot_id
      FROM holding_snapshots hs
      JOIN accounts a ON a.id = hs.account_id
      ${latestSnapshotPerAccountJoinSql("hs")}
      WHERE ${accountsInDataModeWhereSql(mode, "a")}
      ORDER BY a.name ASC
    `,
    )
    .all() as Array<{ account_id: string; account_name: string; account_type: string; snapshot_id: string }>;

  if (snapshots.length === 0) return [];

  const snapsJson = JSON.stringify(snapshots.map((s) => s.snapshot_id));
  const snapshotToAccount = new Map(snapshots.map((s) => [s.snapshot_id, s] as const));
  const bucketsByAccount = new Map<string, Map<AssetClass, number>>();
  for (const s of snapshots) {
    bucketsByAccount.set(s.account_id, new Map());
  }

  const positionRows = db
    .prepare(
      `
      SELECT
        p.snapshot_id,
        a.id AS account_id,
        s.security_type,
        ${POSITION_MARKET_VALUE_SQL} AS market_value,
        p.metadata_json
      FROM positions p
      JOIN securities s ON s.id = p.security_id
      JOIN holding_snapshots hs ON hs.id = p.snapshot_id
      JOIN accounts a ON a.id = hs.account_id
      WHERE p.snapshot_id IN (SELECT value FROM json_each(@snaps))
        AND (s.security_type != 'cash' OR a.id LIKE 'manual_%')
    `,
    )
    .all({ snaps: snapsJson }) as Array<{
    snapshot_id: string;
    account_id: string;
    security_type: string;
    market_value: number | null;
    metadata_json: string | null;
  }>;

  for (const r of positionRows) {
    const buckets = bucketsByAccount.get(r.account_id);
    if (!buckets) continue;
    const mv = r.market_value ?? 0;
    const cls = classify(r.security_type, r.metadata_json);
    if (includeSynthetic && cls === "option") continue;
    buckets.set(cls, (buckets.get(cls) ?? 0) + mv);
  }

  const syntheticBySnapshot = new Map<string, number>();
  if (includeSynthetic && priceByUnderlying) {
    const syntheticRows = db
      .prepare(
        `
        SELECT
          p.snapshot_id,
          us.symbol AS us_symbol,
          sec.symbol AS option_symbol,
          p.quantity * @mult * (${EFFECTIVE_OPTION_DELTA_SQL}) AS synthetic_shares
        FROM positions p
        JOIN holding_snapshots hs ON hs.id = p.snapshot_id
        JOIN securities sec ON sec.id = p.security_id
        LEFT JOIN securities us ON us.id = sec.underlying_security_id
        LEFT JOIN option_greeks og ON og.position_id = p.id
        WHERE p.snapshot_id IN (SELECT value FROM json_each(@snaps))
          AND sec.security_type = 'option'
      `,
      )
      .all({ snaps: snapsJson, mult: 100 }) as Array<{
      snapshot_id: string;
      us_symbol: string | null;
      option_symbol: string | null;
      synthetic_shares: number;
    }>;

    for (const row of syntheticRows) {
      const sym = normalizeOptionUnderlying(row.us_symbol, row.option_symbol);
      if (sym === "CASH") continue;
      const sh = row.synthetic_shares ?? 0;
      const px = priceByUnderlying.get(sym);
      const add = sh * (px ?? 0);
      syntheticBySnapshot.set(row.snapshot_id, (syntheticBySnapshot.get(row.snapshot_id) ?? 0) + add);
    }
  }

  const out: AllocationByAccountRow[] = [];
  for (const s of snapshots) {
    const buckets = bucketsByAccount.get(s.account_id)!;
    if (includeSynthetic) {
      buckets.set(
        "equity",
        (buckets.get("equity") ?? 0) + (syntheticBySnapshot.get(s.snapshot_id) ?? 0),
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

export function getAllocationByBucket(
  includeSynthetic: boolean,
  mode: DataMode = "auto",
  equityMarkMap?: Map<string, number>,
): AllocationBucketedResult {
  const db = getDb();
  const priceByUnderlying =
    includeSynthetic ? (equityMarkMap ?? portfolioImpliedEquityPriceMap(db, mode)) : undefined;
  const scope = latestSnapshotScopeForMode(mode);
  const snapshotIdSet = new Set(latestSnapshotIds(db, scope));

  const snapshots = db
    .prepare(
      `
      SELECT a.id AS account_id, a.name AS account_name, a.nickname AS account_nickname, a.account_bucket AS account_bucket, hs.id AS snapshot_id
      FROM holding_snapshots hs
      JOIN accounts a ON a.id = hs.account_id
      ${latestSnapshotPerAccountJoinSql("hs")}
      WHERE hs.id IN (SELECT value FROM json_each(@snaps))
    `,
    )
    .all({ snaps: JSON.stringify([...snapshotIdSet]) }) as Array<{ account_id: string; account_name: string; account_nickname: string | null; account_bucket: string | null; snapshot_id: string }>;

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


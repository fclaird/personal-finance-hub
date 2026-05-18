import { getDb } from "@/lib/db";
import {
  getUnderlyingExposureRollup,
  portfolioImpliedEquityPriceMap,
  syntheticEquityMvForSnapshot,
} from "@/lib/analytics/optionsExposure";
import { latestSnapshotId } from "@/lib/snapshots";
import type { DataMode } from "@/lib/dataMode";
import { bucketFromAccount } from "@/lib/accountBuckets";
import { notPosterityWhereSql } from "@/lib/posterity";

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
    bucketKey: "brokerage" | "retirement";
    totalMarketValue: number;
    byAssetClass: AllocationBucket[];
  }>;
};

type AssetClass = "equity" | "fund" | "bond" | "cash" | "option" | "other";

function normalizeAssetType(raw: unknown): string {
  return typeof raw === "string" ? raw.toUpperCase() : "";
}

function classify(securityType: string, metadataJson: string | null): AssetClass {
  if (securityType === "option") return "option";
  if (securityType === "equity") return "equity";

  if (!metadataJson) return "other";
  try {
    const parsed = JSON.parse(metadataJson) as { instrument?: { assetType?: unknown } };
    const t = normalizeAssetType(parsed?.instrument?.assetType);
    if (t.includes("CASH")) return "cash";
    if (t.includes("MUTUAL_FUND") || t.includes("ETF") || t.includes("FUND")) return "fund";
    if (t.includes("FIXED_INCOME") || t.includes("BOND")) return "bond";
    if (t.includes("EQUITY")) return "equity";
    if (t.includes("OPTION")) return "option";
    return "other";
  } catch {
    return "other";
  }
}

export function getConsolidatedAllocation(includeSynthetic: boolean, mode: DataMode = "auto"): AllocationResult {
  const db = getDb();
  const snapshotId = latestSnapshotId(db, mode);
  if (!snapshotId) return { totalMarketValue: 0, byAssetClass: [] };

  const rows = db
    .prepare(
      `
      SELECT s.security_type, p.market_value, p.metadata_json
      FROM positions p
      JOIN securities s ON s.id = p.security_id
      WHERE p.snapshot_id = ?
        AND s.security_type != 'cash'
    `,
    )
    .all(snapshotId) as Array<{
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
        AND (
          @mode = 'auto'
          OR (@mode = 'schwab' AND a.id LIKE 'schwab_%')
        )
        AND ${notPosterityWhereSql("a")}
      ORDER BY a.name ASC
    `,
    )
    .all({ mode }) as Array<{ account_id: string; account_name: string; account_type: string; snapshot_id: string }>;

  const out: AllocationByAccountRow[] = [];

  for (const s of snapshots) {
    const rows = db
      .prepare(
        `
        SELECT s.security_type, p.market_value, p.metadata_json
        FROM positions p
        JOIN securities s ON s.id = p.security_id
        WHERE p.snapshot_id = ?
          AND s.security_type != 'cash'
      `,
      )
      .all(s.snapshot_id) as Array<{
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

  const snapshots = db
    .prepare(
      `
      SELECT a.id AS account_id, a.name AS account_name, a.nickname AS account_nickname, hs.id AS snapshot_id
      FROM accounts a
      JOIN holding_snapshots hs ON hs.account_id = a.id
      WHERE hs.as_of = (
        SELECT MAX(hs2.as_of) FROM holding_snapshots hs2 WHERE hs2.account_id = a.id
      )
    `,
    )
    .all() as Array<{ account_id: string; account_name: string; account_nickname: string | null; snapshot_id: string }>;

  const byBucket = new Map<"brokerage" | "retirement", Map<AssetClass, number>>();

  for (const s of snapshots) {
    const bucket = bucketFromAccount(s.account_name, s.account_nickname);
    if (!byBucket.has(bucket)) byBucket.set(bucket, new Map());
    const buckets = byBucket.get(bucket)!;

    const rows = db
      .prepare(
        `
        SELECT s.security_type, p.market_value, p.metadata_json
        FROM positions p
        JOIN securities s ON s.id = p.security_id
        WHERE p.snapshot_id = ?
          AND s.security_type != 'cash'
      `,
      )
      .all(s.snapshot_id) as Array<{
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

  outBuckets.sort((a, b) => (a.bucketKey === "retirement" ? -1 : 1) - (b.bucketKey === "retirement" ? -1 : 1));

  return { includeSynthetic, buckets: outBuckets };
}


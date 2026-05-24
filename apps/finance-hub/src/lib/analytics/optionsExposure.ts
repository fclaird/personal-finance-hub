import { getDb } from "@/lib/db";
import type { DataMode } from "@/lib/dataMode";
import type { AnalyticsBucketKey } from "@/lib/accountBuckets";
import { bucketFromAccount } from "@/lib/accountBuckets";
import { latestSnapshotIds, latestSnapshotScopeForMode, accountsInDataModeWhereSql } from "@/lib/holdings/latestSnapshots";
import { POSITION_MARKET_VALUE_SQL } from "@/lib/holdings/positionMarketValue";
import { normalizeOptionUnderlying } from "@/lib/options/optionUnderlying";

/**
 * Portfolio-wide implied equity price for an underlying (non-option positions only),
 * matching `/api/exposure/details`: SUM(mv)/SUM(qty) across all latest snapshots in `mode`.
 */
export function portfolioImpliedEquityPrice(
  db: ReturnType<typeof getDb>,
  mode: DataMode,
  underlying: string,
): number | null {
  return portfolioImpliedEquityPriceMap(db, mode).get((underlying ?? "").trim().toUpperCase()) ?? null;
}

export function portfolioImpliedEquityPriceMap(db: ReturnType<typeof getDb>, mode: DataMode): Map<string, number> {
  const scope = latestSnapshotScopeForMode(mode);
  const snapshotIds = latestSnapshotIds(db, scope);
  if (snapshotIds.length === 0) return new Map();

  const rows = db
    .prepare(
      `
      SELECT UPPER(COALESCE(s.symbol, '')) AS symbol, SUM(p.quantity) AS qty, SUM(${POSITION_MARKET_VALUE_SQL}) AS mv
      FROM positions p
      JOIN securities s ON s.id = p.security_id
      WHERE p.snapshot_id IN (SELECT value FROM json_each(@snaps))
        AND s.security_type != 'option'
        AND s.security_type != 'cash'
      GROUP BY UPPER(COALESCE(s.symbol, ''))
    `,
    )
    .all({ snaps: JSON.stringify(snapshotIds) }) as Array<{ symbol: string; qty: number | null; mv: number | null }>;

  const out = new Map<string, number>();
  for (const row of rows) {
    const sym = (row.symbol ?? "").trim().toUpperCase();
    const qty = row.qty ?? 0;
    const mv = row.mv ?? 0;
    if (sym && sym !== "CASH" && qty) out.set(sym, mv / qty);
  }
  return out;
}

export type ExposureRow = {
  underlyingSymbol: string;
  spotMarketValue: number;
  heldShares: number;
  syntheticMarketValue: number;
  syntheticShares: number;
  /** Sum of option contract market_value for this underlying (liquidating value from snapshots). */
  optionsMarkMarketValue: number;
};

export type BucketExposure = {
  bucketKey: AnalyticsBucketKey;
  exposure: ExposureRow[];
};

const DEFAULT_CONTRACT_MULTIPLIER = 100;

/** Delta for synthetic exposure: current row, else latest same account+option security. */
export const EFFECTIVE_OPTION_DELTA_SQL = `
  COALESCE(
    CASE WHEN og.delta IS NOT NULL AND ABS(og.delta) > 1e-12 THEN og.delta END,
    (
      SELECT og2.delta
      FROM positions p2
      JOIN holding_snapshots hs2 ON hs2.id = p2.snapshot_id
      JOIN option_greeks og2 ON og2.position_id = p2.id
      WHERE hs2.account_id = hs.account_id
        AND p2.security_id = p.security_id
        AND og2.delta IS NOT NULL
        AND ABS(og2.delta) > 1e-12
      ORDER BY hs2.as_of DESC, hs2.created_at DESC
      LIMIT 1
    ),
    0
  )
`;

export function impliedPriceMapForSnapshot(db: ReturnType<typeof getDb>, snapshotId: string): Map<string, number> {
  const spot = db
    .prepare(
      `
        SELECT
          COALESCE(sec.symbol, 'UNKNOWN') AS symbol,
          SUM(${POSITION_MARKET_VALUE_SQL}) AS mv,
          SUM(COALESCE(p.quantity, 0)) AS qty
        FROM positions p
        JOIN securities sec ON sec.id = p.security_id
        WHERE p.snapshot_id = ?
          AND sec.security_type != 'option'
          AND sec.security_type != 'cash'
        GROUP BY COALESCE(sec.symbol, 'UNKNOWN')
      `,
    )
    .all(snapshotId) as Array<{ symbol: string; mv: number; qty: number }>;

  const implied = new Map<string, number>();
  for (const r of spot) {
    const symKey = (r.symbol ?? "").trim().toUpperCase();
    if (!symKey || symKey === "CASH") continue;
    const qtyRow = db
      .prepare(
        `
          SELECT SUM(quantity) AS qty, SUM(${POSITION_MARKET_VALUE_SQL}) AS mv
          FROM positions p
          JOIN securities sec ON sec.id = p.security_id
          WHERE p.snapshot_id = ?
            AND sec.symbol = ?
            AND sec.security_type != 'option'
        `,
      )
      .get(snapshotId, r.symbol) as { qty: number | null; mv: number | null } | undefined;
    const qty = qtyRow?.qty ?? 0;
    const mv = qtyRow?.mv ?? r.mv ?? 0;
    if (qty) implied.set(symKey, mv / qty);
  }
  return implied;
}

/** Total delta-weighted option exposure as equity MV for one account snapshot (uses portfolio-wide implied px per underlying). */
export function syntheticEquityMvForSnapshot(
  db: ReturnType<typeof getDb>,
  snapshotId: string,
  mode: DataMode = "auto",
  priceByUnderlying = portfolioImpliedEquityPriceMap(db, mode),
): number {
  const rows = db
    .prepare(
      `
        SELECT
          us.symbol AS us_symbol,
          sec.symbol AS option_symbol,
          p.quantity * ? * (${EFFECTIVE_OPTION_DELTA_SQL}) AS synthetic_shares
        FROM positions p
        JOIN holding_snapshots hs ON hs.id = p.snapshot_id
        JOIN securities sec ON sec.id = p.security_id
        LEFT JOIN securities us ON us.id = sec.underlying_security_id
        LEFT JOIN option_greeks og ON og.position_id = p.id
        WHERE p.snapshot_id = ?
          AND sec.security_type = 'option'
      `,
    )
    .all(DEFAULT_CONTRACT_MULTIPLIER, snapshotId) as Array<{
    us_symbol: string | null;
    option_symbol: string | null;
    synthetic_shares: number;
  }>;

  let sum = 0;
  for (const row of rows) {
    const key = normalizeOptionUnderlying(row.us_symbol, row.option_symbol);
    if (key === "CASH") continue;
    const sh = row.synthetic_shares ?? 0;
    const px = priceByUnderlying.get(key);
    sum += sh * (px ?? 0);
  }
  return sum;
}

export function rollupExposureBuckets(buckets: BucketExposure[]): ExposureRow[] {
  const bySym = new Map<string, ExposureRow>();
  for (const b of buckets) {
    for (const r of b.exposure) {
      const prev = bySym.get(r.underlyingSymbol) ?? {
        underlyingSymbol: r.underlyingSymbol,
        spotMarketValue: 0,
        heldShares: 0,
        syntheticMarketValue: 0,
        syntheticShares: 0,
        optionsMarkMarketValue: 0,
      };
      prev.spotMarketValue += r.spotMarketValue;
      prev.heldShares += r.heldShares;
      prev.syntheticMarketValue += r.syntheticMarketValue;
      prev.syntheticShares += r.syntheticShares;
      prev.optionsMarkMarketValue += r.optionsMarkMarketValue;
      bySym.set(r.underlyingSymbol, prev);
    }
  }

  const out = Array.from(bySym.values());
  out.sort(
    (a, b) => Math.abs(b.spotMarketValue + b.syntheticMarketValue) - Math.abs(a.spotMarketValue + a.syntheticMarketValue),
  );
  return out;
}

export function getUnderlyingExposureRollup(mode: DataMode = "auto"): ExposureRow[] {
  return rollupExposureBuckets(getUnderlyingExposureByBucket(mode));
}

export function getUnderlyingExposureByBucket(mode: DataMode = "auto"): BucketExposure[] {
  const db = getDb();
  const scope = latestSnapshotScopeForMode(mode);
  const snapshotIds = latestSnapshotIds(db, scope);
  if (snapshotIds.length === 0) return [];

  const snapshotIdSet = new Set(snapshotIds);
  const snapsJson = JSON.stringify(snapshotIds);

  const snapshots = db
    .prepare(
      `
      SELECT a.name AS account_name, a.nickname AS account_nickname, a.account_bucket AS account_bucket, hs.id AS snapshot_id
      FROM holding_snapshots hs
      JOIN accounts a ON a.id = hs.account_id
      WHERE hs.id IN (SELECT value FROM json_each(@snaps))
        AND ${accountsInDataModeWhereSql(mode, "a")}
    `,
    )
    .all({ snaps: snapsJson }) as Array<{ account_name: string; account_nickname: string | null; account_bucket: string | null; snapshot_id: string }>;

  const snapshotToBucket = new Map<string, AnalyticsBucketKey>();
  for (const s of snapshots) {
    if (!snapshotIdSet.has(s.snapshot_id)) continue;
    snapshotToBucket.set(
      s.snapshot_id,
      bucketFromAccount(s.account_name, s.account_nickname, s.account_bucket),
    );
  }
  if (snapshotToBucket.size === 0) return [];

  const byBucket = new Map<AnalyticsBucketKey, Map<string, ExposureRow>>();

  function rowFor(bucket: AnalyticsBucketKey, sym: string): ExposureRow {
    if (!byBucket.has(bucket)) byBucket.set(bucket, new Map());
    const map = byBucket.get(bucket)!;
    const prev = map.get(sym) ?? {
      underlyingSymbol: sym,
      spotMarketValue: 0,
      heldShares: 0,
      syntheticMarketValue: 0,
      syntheticShares: 0,
      optionsMarkMarketValue: 0,
    };
    return prev;
  }

  function commit(bucket: AnalyticsBucketKey, sym: string, row: ExposureRow) {
    byBucket.get(bucket)!.set(sym, row);
  }

  const spot = db
    .prepare(
      `
        SELECT
          p.snapshot_id,
          COALESCE(sec.symbol, 'UNKNOWN') AS symbol,
          SUM(${POSITION_MARKET_VALUE_SQL}) AS mv,
          SUM(COALESCE(p.quantity, 0)) AS qty
        FROM positions p
        JOIN securities sec ON sec.id = p.security_id
        WHERE p.snapshot_id IN (SELECT value FROM json_each(@snaps))
          AND sec.security_type != 'option'
          AND sec.security_type != 'cash'
        GROUP BY p.snapshot_id, COALESCE(sec.symbol, 'UNKNOWN')
      `,
    )
    .all({ snaps: snapsJson }) as Array<{ snapshot_id: string; symbol: string; mv: number; qty: number }>;

  for (const r of spot) {
    const bucket = snapshotToBucket.get(r.snapshot_id);
    if (!bucket) continue;
    const symKey = (r.symbol ?? "").trim().toUpperCase();
    if (symKey === "CASH") continue;
    const prev = rowFor(bucket, symKey);
    prev.spotMarketValue += r.mv;
    prev.heldShares += r.qty ?? 0;
    commit(bucket, symKey, prev);
  }

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
    .all({ snaps: snapsJson, mult: DEFAULT_CONTRACT_MULTIPLIER }) as Array<{
    snapshot_id: string;
    us_symbol: string | null;
    option_symbol: string | null;
    synthetic_shares: number;
  }>;

  for (const row of syntheticRows) {
    const bucket = snapshotToBucket.get(row.snapshot_id);
    if (!bucket) continue;
    const sym = normalizeOptionUnderlying(row.us_symbol, row.option_symbol);
    if (sym === "CASH") continue;
    const prev = rowFor(bucket, sym);
    prev.syntheticShares += row.synthetic_shares ?? 0;
    commit(bucket, sym, prev);
  }

  const optionMarkRows = db
    .prepare(
      `
        SELECT
          p.snapshot_id,
          us.symbol AS us_symbol,
          sec.symbol AS option_symbol,
          COALESCE(p.market_value, 0) AS mv
        FROM positions p
        JOIN securities sec ON sec.id = p.security_id
        LEFT JOIN securities us ON us.id = sec.underlying_security_id
        WHERE p.snapshot_id IN (SELECT value FROM json_each(@snaps))
          AND sec.security_type = 'option'
      `,
    )
    .all({ snaps: snapsJson }) as Array<{
    snapshot_id: string;
    us_symbol: string | null;
    option_symbol: string | null;
    mv: number;
  }>;

  for (const row of optionMarkRows) {
    const bucket = snapshotToBucket.get(row.snapshot_id);
    if (!bucket) continue;
    const sym = normalizeOptionUnderlying(row.us_symbol, row.option_symbol);
    if (sym === "CASH") continue;
    const prev = rowFor(bucket, sym);
    prev.optionsMarkMarketValue += row.mv ?? 0;
    commit(bucket, sym, prev);
  }

  const priceByUnderlying = portfolioImpliedEquityPriceMap(db, mode);
  for (const m of byBucket.values()) {
    for (const row of m.values()) {
      const px = priceByUnderlying.get(row.underlyingSymbol);
      row.syntheticMarketValue = row.syntheticShares * (px ?? 0);
    }
  }

  const out: BucketExposure[] = [];
  for (const [bucketKey, m] of byBucket.entries()) {
    const exposure = Array.from(m.values()).sort(
      (a, b) => Math.abs(b.spotMarketValue + b.syntheticMarketValue) - Math.abs(a.spotMarketValue + a.syntheticMarketValue),
    );
    out.push({ bucketKey, exposure });
  }

  const bucketOrder: Record<AnalyticsBucketKey, number> = { retirement: 0, brokerage: 1, "529": 2 };
  out.sort((a, b) => bucketOrder[a.bucketKey] - bucketOrder[b.bucketKey]);
  return out;
}

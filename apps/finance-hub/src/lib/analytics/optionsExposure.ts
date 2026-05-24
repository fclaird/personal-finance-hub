import { getDb } from "@/lib/db";
import type { DataMode } from "@/lib/dataMode";
import type { AnalyticsBucketKey } from "@/lib/accountBuckets";
import { bucketFromAccount } from "@/lib/accountBuckets";
import { latestSnapshotIds, latestSnapshotScopeForMode } from "@/lib/holdings/latestSnapshots";
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

export function getUnderlyingExposureRollup(mode: DataMode = "auto"): ExposureRow[] {
  // Reuse the bucketed exposure implementation and merge buckets back into a combined rollup.
  const bySym = new Map<string, ExposureRow>();
  for (const b of getUnderlyingExposureByBucket(mode)) {
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

export function getUnderlyingExposureByBucket(mode: DataMode = "auto"): BucketExposure[] {
  const db = getDb();
  const scope = latestSnapshotScopeForMode(mode);
  const snapshotIdSet = new Set(latestSnapshotIds(db, scope));

  const snapshots = db
    .prepare(
      `
      SELECT a.name AS account_name, a.nickname AS account_nickname, a.account_bucket AS account_bucket, hs.id AS snapshot_id
      FROM accounts a
      JOIN holding_snapshots hs ON hs.account_id = a.id
      WHERE hs.as_of = (
        SELECT MAX(hs2.as_of) FROM holding_snapshots hs2 WHERE hs2.account_id = a.id
      )
    `,
    )
    .all() as Array<{ account_name: string; account_nickname: string | null; account_bucket: string | null; snapshot_id: string }>;

  const byBucket = new Map<AnalyticsBucketKey, Map<string, ExposureRow>>();
  const priceByUnderlying = portfolioImpliedEquityPriceMap(db, mode);

  for (const s of snapshots) {
    if (!snapshotIdSet.has(s.snapshot_id)) continue;
    const bucket = bucketFromAccount(s.account_name, s.account_nickname, s.account_bucket);
    if (!byBucket.has(bucket)) byBucket.set(bucket, new Map());
    const map = byBucket.get(bucket)!;

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
      .all(s.snapshot_id) as Array<{ symbol: string; mv: number; qty: number }>;

    const syntheticRows = db
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
      .all(DEFAULT_CONTRACT_MULTIPLIER, s.snapshot_id) as Array<{
      us_symbol: string | null;
      option_symbol: string | null;
      synthetic_shares: number;
    }>;

    const optionMarkRows = db
      .prepare(
        `
        SELECT
          us.symbol AS us_symbol,
          sec.symbol AS option_symbol,
          COALESCE(p.market_value, 0) AS mv
        FROM positions p
        JOIN securities sec ON sec.id = p.security_id
        LEFT JOIN securities us ON us.id = sec.underlying_security_id
        WHERE p.snapshot_id = ?
          AND sec.security_type = 'option'
      `,
      )
      .all(s.snapshot_id) as Array<{
      us_symbol: string | null;
      option_symbol: string | null;
      mv: number;
    }>;

    for (const r of spot) {
      const symKey = (r.symbol ?? "").trim().toUpperCase();
      if (symKey === "CASH") continue;
      const prev = map.get(symKey) ?? {
        underlyingSymbol: symKey,
        spotMarketValue: 0,
        heldShares: 0,
        syntheticMarketValue: 0,
        syntheticShares: 0,
        optionsMarkMarketValue: 0,
      };
      prev.spotMarketValue += r.mv;
      prev.heldShares += r.qty ?? 0;
      map.set(symKey, prev);
    }

    for (const row of optionMarkRows) {
      const sym = normalizeOptionUnderlying(row.us_symbol, row.option_symbol);
      if (sym === "CASH") continue;
      const prev = map.get(sym) ?? {
        underlyingSymbol: sym,
        spotMarketValue: 0,
        heldShares: 0,
        syntheticMarketValue: 0,
        syntheticShares: 0,
        optionsMarkMarketValue: 0,
      };
      prev.optionsMarkMarketValue += row.mv ?? 0;
      map.set(sym, prev);
    }

    for (const row of syntheticRows) {
      const sym = normalizeOptionUnderlying(row.us_symbol, row.option_symbol);
      if (sym === "CASH") continue;
      const prev = map.get(sym) ?? {
        underlyingSymbol: sym,
        spotMarketValue: 0,
        heldShares: 0,
        syntheticMarketValue: 0,
        syntheticShares: 0,
        optionsMarkMarketValue: 0,
      };
      const sh = row.synthetic_shares ?? 0;
      prev.syntheticShares += sh;
      map.set(sym, prev);
    }
  }

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

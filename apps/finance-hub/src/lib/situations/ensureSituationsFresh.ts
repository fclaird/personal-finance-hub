import type Database from "better-sqlite3";

import { rebuildAutoSituations } from "@/lib/situations/persistSituations";

/** Safety refresh even if fingerprint looks unchanged (wipes, clock skew, etc.). */
export const SITUATIONS_FRESH_MAX_AGE_MS = 6 * 60 * 60 * 1000;

export type EnsureSituationsFreshReason = "empty" | "fingerprint" | "stale" | "forced" | "unchanged" | "concurrent";

export type EnsureSituationsFreshResult = {
  rebuilt: boolean;
  reason: EnsureSituationsFreshReason;
  fingerprint: string;
  proposed?: number;
  kept?: number;
};

const META_FINGERPRINT = "fingerprint";
const META_REBUILT_AT = "rebuilt_at";

/** Process-level gate so concurrent GETs do not double-rebuild (~10s). */
let rebuilding = false;

function ensureMetaTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS situation_link_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

function getMeta(db: Database.Database, key: string): string | null {
  ensureMetaTable(db);
  const row = db.prepare(`SELECT value AS value FROM situation_link_meta WHERE key = ?`).get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

function setMeta(db: Database.Database, key: string, value: string): void {
  ensureMetaTable(db);
  db.prepare(
    `
    INSERT INTO situation_link_meta (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `,
  ).run(key, value);
}

/**
 * Fingerprint broker option TRADE fills the linker cares about.
 * Same TRADE filter as loadLinkableBrokerTransactions; option columns approximate option legs.
 */
export function brokerOptionFillsFingerprint(db: Database.Database): string {
  const row = db
    .prepare(
      `
      SELECT
        COUNT(*) AS c,
        MAX(id) AS maxId,
        MAX(trade_date) AS maxDate
      FROM broker_transactions
      WHERE UPPER(COALESCE(transaction_type, 'TRADE')) = 'TRADE'
        AND (
          option_right IS NOT NULL
          OR option_expiration IS NOT NULL
          OR UPPER(COALESCE(asset_type, '')) = 'OPTION'
        )
    `,
    )
    .get() as { c: number; maxId: string | null; maxDate: string | null };
  return `${row.c}|${row.maxId ?? ""}|${row.maxDate ?? ""}`;
}

export function recordSituationsLinkFingerprint(db: Database.Database, fingerprint?: string): string {
  const fp = fingerprint ?? brokerOptionFillsFingerprint(db);
  setMeta(db, META_FINGERPRINT, fp);
  setMeta(db, META_REBUILT_AT, new Date().toISOString());
  return fp;
}

function situationsCount(db: Database.Database): number {
  return (db.prepare(`SELECT COUNT(*) AS c FROM option_situations`).get() as { c: number }).c;
}

/** Exported for unit tests. */
export function situationsRebuildNeeded(
  db: Database.Database,
  fingerprint: string,
  nowMs: number = Date.now(),
): { needed: boolean; reason: Exclude<EnsureSituationsFreshReason, "forced" | "concurrent" | "unchanged"> | "unchanged" } {
  if (situationsCount(db) === 0) return { needed: true, reason: "empty" };
  const lastFp = getMeta(db, META_FINGERPRINT);
  if (lastFp !== fingerprint) return { needed: true, reason: "fingerprint" };
  const rebuiltAt = getMeta(db, META_REBUILT_AT);
  if (!rebuiltAt) return { needed: true, reason: "stale" };
  const at = Date.parse(rebuiltAt);
  if (!Number.isFinite(at) || nowMs - at > SITUATIONS_FRESH_MAX_AGE_MS) {
    return { needed: true, reason: "stale" };
  }
  return { needed: false, reason: "unchanged" };
}

/**
 * Ensure option situation links match latest broker option fills.
 * Rebuilds when the book is empty, fills fingerprint changed, or last rebuild is older than ~6h.
 */
export function ensureSituationsFresh(
  db: Database.Database,
  opts?: { force?: boolean; nowMs?: number },
): EnsureSituationsFreshResult {
  const force = Boolean(opts?.force);
  const nowMs = opts?.nowMs ?? Date.now();
  const fingerprint = brokerOptionFillsFingerprint(db);

  if (rebuilding) {
    return { rebuilt: false, reason: "concurrent", fingerprint };
  }

  if (!force) {
    const check = situationsRebuildNeeded(db, fingerprint, nowMs);
    if (!check.needed) {
      return { rebuilt: false, reason: "unchanged", fingerprint };
    }
    rebuilding = true;
    try {
      const stats = rebuildAutoSituations(db);
      const fp = recordSituationsLinkFingerprint(db, fingerprint);
      return { rebuilt: true, reason: check.reason as Exclude<EnsureSituationsFreshReason, "forced" | "concurrent" | "unchanged">, fingerprint: fp, ...stats };
    } finally {
      rebuilding = false;
    }
  }

  rebuilding = true;
  try {
    const stats = rebuildAutoSituations(db);
    const fp = recordSituationsLinkFingerprint(db);
    return { rebuilt: true, reason: "forced", fingerprint: fp, ...stats };
  } finally {
    rebuilding = false;
  }
}

/** Test helper — reset process mutex between cases. */
export function __resetEnsureSituationsFreshMutexForTests(): void {
  rebuilding = false;
}

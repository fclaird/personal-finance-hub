import type Database from "better-sqlite3";

import type { AccountBucket } from "@/lib/accountBuckets";
import { isValidAccountBucket } from "@/lib/accountBuckets";
import { getDb } from "@/lib/db";
import { newId } from "@/lib/id";
import { isManualAccountId } from "@/lib/manual/isManualAccountId";

export { isManualAccountId } from "@/lib/manual/isManualAccountId";

export const MANUAL_CONNECTION_ID = "conn_manual";

export type ManualPositionInput = {
  positionId?: string;
  symbol: string;
  securityType: "equity" | "fund" | "cash";
  quantity: number;
  purchasePrice: number | null;
  marketValue: number | null;
  purchaseDate: string | null;
  notes?: string | null;
};

export type ManualAccountRecord = {
  id: string;
  name: string;
  nickname: string | null;
  accountBucket: AccountBucket;
  type: string;
  connectionId: string;
};

export type ManualPositionMetadata = {
  source: "manual";
  purchaseDate: string | null;
  notes?: string | null;
};

function normSym(s: string) {
  return (s ?? "").trim().toUpperCase();
}

function parseIsoDate(v: string | null | undefined): string | null {
  if (!v || typeof v !== "string") return null;
  const t = v.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  return t;
}

export function ensureManualConnection(db: Database.Database): void {
  db.prepare(
    `
    INSERT INTO institution_connections (id, type, display_name, status, updated_at)
    VALUES (@id, 'manual', 'External / Manual', 'active', datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      type = excluded.type,
      display_name = excluded.display_name,
      status = 'active',
      updated_at = excluded.updated_at
  `,
  ).run({ id: MANUAL_CONNECTION_ID });
}

function assertManualAccount(db: Database.Database, accountId: string): ManualAccountRecord {
  const row = db
    .prepare(
      `
      SELECT id, name, nickname, account_bucket AS accountBucket, type, connection_id AS connectionId
      FROM accounts
      WHERE id = ?
    `,
    )
    .get(accountId) as ManualAccountRecord | undefined;
  if (!row || !isManualAccountId(row.id)) {
    throw new Error("Manual account not found");
  }
  if (row.connectionId !== MANUAL_CONNECTION_ID) {
    throw new Error("Not a manual account");
  }
  return row;
}

function latestManualSnapshotId(db: Database.Database, accountId: string): string | null {
  const row = db
    .prepare(
      `
      SELECT id FROM holding_snapshots
      WHERE account_id = ?
      ORDER BY as_of DESC
      LIMIT 1
    `,
    )
    .get(accountId) as { id: string } | undefined;
  return row?.id ?? null;
}

function ensureManualSnapshot(db: Database.Database, accountId: string): string {
  const existing = latestManualSnapshotId(db, accountId);
  if (existing) return existing;
  const snapshotId = newId("snap");
  const nowIso = new Date().toISOString();
  db.prepare(
    `
    INSERT INTO holding_snapshots (id, account_id, as_of)
    VALUES (@id, @account_id, @as_of)
  `,
  ).run({ id: snapshotId, account_id: accountId, as_of: nowIso });
  return snapshotId;
}

function touchManualSnapshot(db: Database.Database, accountId: string): string {
  const snapshotId = ensureManualSnapshot(db, accountId);
  db.prepare(`UPDATE holding_snapshots SET as_of = @as_of WHERE id = @id`).run({
    id: snapshotId,
    as_of: new Date().toISOString(),
  });
  return snapshotId;
}

function securityTypeForInput(input: ManualPositionInput): "equity" | "fund" | "cash" {
  if (input.securityType === "cash") return "cash";
  return input.securityType === "fund" ? "fund" : "equity";
}

function resolveSecurity(db: Database.Database, input: ManualPositionInput, nowIso: string): string {
  const type = securityTypeForInput(input);
  if (type === "cash") {
    db.prepare(
      `
      INSERT INTO securities (id, symbol, name, security_type, updated_at)
      VALUES ('sec_CASH', 'CASH', 'Cash', 'cash', @now)
      ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at
    `,
    ).run({ now: nowIso });
    return "sec_CASH";
  }
  const sym = normSym(input.symbol);
  if (!sym) throw new Error("Symbol is required");
  const securityId = `sec_${sym}`;
  db.prepare(
    `
    INSERT INTO securities (id, symbol, name, security_type, updated_at)
    VALUES (@id, @symbol, @name, @security_type, @now)
    ON CONFLICT(id) DO UPDATE SET symbol = excluded.symbol, name = excluded.name, security_type = excluded.security_type, updated_at = excluded.updated_at
  `,
  ).run({
    id: securityId,
    symbol: sym,
    name: sym,
    security_type: type,
    now: nowIso,
  });
  return securityId;
}

function metadataFor(input: ManualPositionInput): string {
  const meta: ManualPositionMetadata = {
    source: "manual",
    purchaseDate: parseIsoDate(input.purchaseDate),
    notes: input.notes?.trim() || null,
  };
  return JSON.stringify(meta);
}

export function parseManualPositionMetadata(raw: string | null | undefined): ManualPositionMetadata | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (o.source !== "manual") return null;
    return {
      source: "manual",
      purchaseDate: typeof o.purchaseDate === "string" ? o.purchaseDate : null,
      notes: typeof o.notes === "string" ? o.notes : null,
    };
  } catch {
    return null;
  }
}

export function createManualAccount(params: {
  name: string;
  nickname?: string | null;
  accountBucket: AccountBucket;
}): ManualAccountRecord {
  const name = (params.name ?? "").trim();
  if (!name) throw new Error("Account name is required");
  if (!isValidAccountBucket(params.accountBucket)) throw new Error("Invalid account bucket");

  const db = getDb();
  ensureManualConnection(db);
  const accountId = newId("manual");
  const nowIso = new Date().toISOString();
  const nickname = (params.nickname ?? "").trim() || null;

  const tx = db.transaction(() => {
    db.prepare(
      `
      INSERT INTO accounts (id, connection_id, name, nickname, account_bucket, type, currency, updated_at)
      VALUES (@id, @connection_id, @name, @nickname, @account_bucket, 'manual', 'USD', @now)
    `,
    ).run({
      id: accountId,
      connection_id: MANUAL_CONNECTION_ID,
      name,
      nickname,
      account_bucket: params.accountBucket,
      now: nowIso,
    });
    ensureManualSnapshot(db, accountId);
  });
  tx();

  return {
    id: accountId,
    name,
    nickname,
    accountBucket: params.accountBucket,
    type: "manual",
    connectionId: MANUAL_CONNECTION_ID,
  };
}

export function updateManualAccount(
  accountId: string,
  params: { name?: string; nickname?: string | null; accountBucket?: AccountBucket },
): ManualAccountRecord {
  const db = getDb();
  const existing = assertManualAccount(db, accountId);
  const name = params.name != null ? params.name.trim() : existing.name;
  if (!name) throw new Error("Account name is required");
  const nickname = params.nickname !== undefined ? (params.nickname ?? "").trim() || null : existing.nickname;
  const accountBucket =
    params.accountBucket != null && isValidAccountBucket(params.accountBucket)
      ? params.accountBucket
      : existing.accountBucket;

  db.prepare(
    `
    UPDATE accounts
    SET name = @name, nickname = @nickname, account_bucket = @account_bucket, updated_at = @now
    WHERE id = @id
  `,
  ).run({ id: accountId, name, nickname, account_bucket: accountBucket, now: new Date().toISOString() });

  return { ...existing, name, nickname, accountBucket };
}

export function deleteManualAccount(accountId: string): void {
  const db = getDb();
  assertManualAccount(db, accountId);
  db.prepare(`DELETE FROM accounts WHERE id = ?`).run(accountId);
}

export function upsertManualPosition(accountId: string, input: ManualPositionInput): { positionId: string } {
  const db = getDb();
  assertManualAccount(db, accountId);

  const qty = input.quantity;
  if (!Number.isFinite(qty) || qty === 0) throw new Error("Quantity must be non-zero");

  const type = securityTypeForInput(input);
  if (type !== "cash" && !normSym(input.symbol)) throw new Error("Symbol is required");

  const purchaseDate = parseIsoDate(input.purchaseDate);
  if (input.purchaseDate && !purchaseDate) throw new Error("Purchase date must be YYYY-MM-DD");

  const nowIso = new Date().toISOString();
  const snapshotId = touchManualSnapshot(db, accountId);
  const securityId = resolveSecurity(db, input, nowIso);
  const positionId = input.positionId?.trim() || newId("pos");

  const price = input.purchasePrice;
  let marketValue = input.marketValue;
  if (type === "cash") {
    marketValue = Math.abs(qty);
  } else if (marketValue == null && price != null && Number.isFinite(price)) {
    marketValue = price * qty;
  }

  const tx = db.transaction(() => {
    const existing = db
      .prepare(`SELECT id FROM positions WHERE id = ? AND snapshot_id = ?`)
      .get(positionId, snapshotId) as { id: string } | undefined;

    const payload = {
      id: positionId,
      snapshot_id: snapshotId,
      security_id: securityId,
      quantity: qty,
      price: price ?? null,
      market_value: marketValue ?? null,
      metadata_json: metadataFor({ ...input, purchaseDate }),
    };

    if (existing) {
      db.prepare(
        `
        UPDATE positions
        SET security_id = @security_id, quantity = @quantity, price = @price,
            market_value = @market_value, metadata_json = @metadata_json
        WHERE id = @id
      `,
      ).run(payload);
    } else {
      db.prepare(
        `
        INSERT INTO positions (id, snapshot_id, security_id, quantity, price, market_value, metadata_json)
        VALUES (@id, @snapshot_id, @security_id, @quantity, @price, @market_value, @metadata_json)
      `,
      ).run(payload);
    }
  });
  tx();

  return { positionId };
}

export function deleteManualPosition(positionId: string): void {
  const db = getDb();
  const row = db
    .prepare(
      `
      SELECT p.id, hs.account_id AS accountId
      FROM positions p
      JOIN holding_snapshots hs ON hs.id = p.snapshot_id
      JOIN accounts a ON a.id = hs.account_id
      WHERE p.id = ?
    `,
    )
    .get(positionId) as { id: string; accountId: string } | undefined;

  if (!row || !isManualAccountId(row.accountId)) {
    throw new Error("Manual position not found");
  }

  db.prepare(`DELETE FROM positions WHERE id = ?`).run(positionId);
  touchManualSnapshot(db, row.accountId);
}

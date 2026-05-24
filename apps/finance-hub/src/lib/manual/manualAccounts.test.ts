import fs from "node:fs";
import path from "node:path";

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";

import {
  ensureManualConnection,
  MANUAL_CONNECTION_ID,
  parseManualPositionMetadata,
} from "./manualAccounts";
import { isManualAccountId } from "./isManualAccountId";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  const schemaPath = path.join(process.cwd(), "src", "db", "schema.sql");
  db.exec(fs.readFileSync(schemaPath, "utf-8"));
  return db;
}

describe("manualAccounts", () => {
  it("isManualAccountId identifies manual accounts", () => {
    assert.equal(isManualAccountId("manual_abc"), true);
    assert.equal(isManualAccountId("schwab_abc"), false);
  });

  it("parseManualPositionMetadata reads manual source fields", () => {
    const meta = parseManualPositionMetadata(
      JSON.stringify({ source: "manual", purchaseDate: "2024-01-15", notes: "gift" }),
    );
    assert.deepEqual(meta, { source: "manual", purchaseDate: "2024-01-15", notes: "gift" });
    assert.equal(parseManualPositionMetadata(JSON.stringify({ source: "schwab" })), null);
  });

  it("ensureManualConnection and manual account rows persist with account_bucket", () => {
    const db = createTestDb();
    ensureManualConnection(db);

    const conn = db
      .prepare(`SELECT id, type FROM institution_connections WHERE id = ?`)
      .get(MANUAL_CONNECTION_ID) as { id: string; type: string };
    assert.equal(conn.type, "manual");

    const accountId = "manual_test1";
    db.prepare(
      `
      INSERT INTO accounts (id, connection_id, name, nickname, account_bucket, type, currency, updated_at)
      VALUES (@id, @connection_id, @name, @nickname, @account_bucket, 'manual', 'USD', datetime('now'))
    `,
    ).run({
      id: accountId,
      connection_id: MANUAL_CONNECTION_ID,
      name: "529 Plan",
      nickname: null,
      account_bucket: "529",
    });

    const snapId = "snap_test1";
    db.prepare(`INSERT INTO holding_snapshots (id, account_id, as_of) VALUES (?, ?, datetime('now'))`).run(
      snapId,
      accountId,
    );

    db.prepare(`INSERT INTO securities (id, symbol, name, security_type) VALUES ('sec_AAPL', 'AAPL', 'AAPL', 'equity')`).run();
    db.prepare(
      `
      INSERT INTO positions (id, snapshot_id, security_id, quantity, price, market_value, metadata_json)
      VALUES ('pos1', ?, 'sec_AAPL', 10, 150, 1800, ?)
    `,
    ).run(
      snapId,
      JSON.stringify({ source: "manual", purchaseDate: "2023-06-01", notes: null }),
    );

    const row = db
      .prepare(
        `
      SELECT a.account_bucket AS bucket, p.metadata_json AS meta
      FROM accounts a
      JOIN holding_snapshots hs ON hs.account_id = a.id
      JOIN positions p ON p.snapshot_id = hs.id
      WHERE a.id = ?
    `,
      )
      .get(accountId) as { bucket: string; meta: string };

    assert.equal(row.bucket, "529");
    assert.equal(parseManualPositionMetadata(row.meta)?.purchaseDate, "2023-06-01");
  });
});

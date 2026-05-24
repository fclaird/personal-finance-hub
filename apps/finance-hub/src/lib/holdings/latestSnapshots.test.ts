import fs from "node:fs";
import path from "node:path";

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";

import { bucketFromAccount } from "@/lib/accountBuckets";
import { latestSnapshotIds } from "@/lib/holdings/latestSnapshots";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  const schemaPath = path.join(process.cwd(), "src", "db", "schema.sql");
  db.exec(fs.readFileSync(schemaPath, "utf-8"));
  return db;
}

function seedAccount(
  db: Database.Database,
  accountId: string,
  bucket: string,
  snapshotId: string,
  asOf: string,
) {
  db.prepare(
    `INSERT OR IGNORE INTO institution_connections (id, type, display_name, status) VALUES ('conn1', 'schwab', 'Test', 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO accounts (id, connection_id, name, nickname, account_bucket, type) VALUES (?, 'conn1', ?, ?, ?, 'brokerage')`,
  ).run(accountId, accountId, null, bucket);
  db.prepare(`INSERT INTO holding_snapshots (id, account_id, as_of) VALUES (?, ?, ?)`).run(snapshotId, accountId, asOf);
}

describe("latestSnapshotIds", () => {
  it("all_synced includes Schwab and manual accounts", () => {
    const db = createTestDb();
    seedAccount(db, "schwab_a", "brokerage", "snap_a", "2025-06-01T12:00:00Z");
    seedAccount(db, "manual_b", "529", "snap_b", "2025-06-02T12:00:00Z");
    db.prepare(
      `INSERT INTO institution_connections (id, type, display_name, status) VALUES ('conn_manual', 'manual', 'Manual', 'active')`,
    ).run();
    db.prepare(`UPDATE accounts SET connection_id = 'conn_manual', type = 'manual' WHERE id = 'manual_b'`).run();

    const ids = latestSnapshotIds(db, "all_synced");
    assert.deepEqual(ids.sort(), ["snap_a", "snap_b"]);
  });

  it("schwab_only includes Schwab and manual external accounts", () => {
    const db = createTestDb();
    seedAccount(db, "schwab_a", "brokerage", "snap_a", "2025-06-01T12:00:00Z");
    seedAccount(db, "manual_b", "529", "snap_b", "2025-06-02T12:00:00Z");
    db.prepare(
      `INSERT INTO institution_connections (id, type, display_name, status) VALUES ('conn_manual', 'manual', 'Manual', 'active')`,
    ).run();
    db.prepare(`UPDATE accounts SET connection_id = 'conn_manual', type = 'manual' WHERE id = 'manual_b'`).run();

    const ids = latestSnapshotIds(db, "schwab_only");
    assert.deepEqual(ids.sort(), ["snap_a", "snap_b"]);
  });

  it("excludes demo accounts from all_synced", () => {
    const db = createTestDb();
    seedAccount(db, "demo_x", "brokerage", "snap_demo", "2025-06-01T12:00:00Z");

    const ids = latestSnapshotIds(db, "all_synced");
    assert.deepEqual(ids, []);
  });

  it("uses latest snapshot per account when multiple exist", () => {
    const db = createTestDb();
    seedAccount(db, "schwab_a", "brokerage", "snap_old", "2025-06-01T12:00:00Z");
    db.prepare(`INSERT INTO holding_snapshots (id, account_id, as_of) VALUES ('snap_new', 'schwab_a', '2025-06-03T12:00:00Z')`).run();

    const ids = latestSnapshotIds(db, "all_synced");
    assert.deepEqual(ids, ["snap_new"]);
  });
});

describe("allocation bucket assignment", () => {
  it("529 manual account maps to 529 bucket", () => {
    assert.equal(bucketFromAccount("Vanguard 529", null, "529"), "529");
  });

  it("brokerage and retirement buckets stay separate", () => {
    assert.equal(bucketFromAccount("Taxable", null, "brokerage"), "brokerage");
    assert.equal(bucketFromAccount("IRA", null, "retirement"), "retirement");
  });
});

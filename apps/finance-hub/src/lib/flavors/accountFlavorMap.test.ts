import fs from "node:fs";
import path from "node:path";

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";

import { FLAVOR_IDS, type FlavorId } from "@/lib/flavor";
import {
  isAccountInFlavor,
  PEYTON_ACCOUNT_ID,
  RORIE_ACCOUNT_ID,
} from "@/lib/flavors/accounts";
import { latestSnapshotIds } from "@/lib/holdings/latestSnapshots";
import { dividendAccountWhereSql, loadLatestSchwabPositionRows } from "@/lib/dividends/schwabDividendBook";

/** Known Schwab accounts and the one flavor each belongs to. */
const SCHWAB_FLAVOR_MAP: Array<{ id: string; flavor: FlavorId }> = [
  { id: RORIE_ACCOUNT_ID, flavor: "rorie" },
  { id: PEYTON_ACCOUNT_ID, flavor: "peyton" },
  { id: "schwab_11111111", flavor: "main" },
  { id: "schwab_other", flavor: "main" },
];

function flavorsContaining(accountId: string): FlavorId[] {
  return FLAVOR_IDS.filter((flavor) => isAccountInFlavor(flavor, accountId));
}

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  const schemaPath = path.join(process.cwd(), "src", "db", "schema.sql");
  db.exec(fs.readFileSync(schemaPath, "utf-8"));
  return db;
}

function seedAccount(db: Database.Database, accountId: string, snapshotId: string) {
  db.prepare(
    `INSERT OR IGNORE INTO institution_connections (id, type, display_name, status) VALUES ('conn1', 'schwab', 'Test', 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO accounts (id, connection_id, name, nickname, account_bucket, type) VALUES (?, 'conn1', ?, NULL, 'brokerage', 'brokerage')`,
  ).run(accountId, accountId);
  db.prepare(`INSERT INTO holding_snapshots (id, account_id, as_of) VALUES (?, ?, ?)`).run(
    snapshotId,
    accountId,
    "2026-06-01T16:00:00Z",
  );
}

function seedEquity(db: Database.Database, snapshotId: string, symbol: string) {
  const secId = `sec_${snapshotId}_${symbol}`;
  db.prepare(
    `INSERT INTO securities (id, symbol, name, security_type) VALUES (?, ?, ?, 'equity')`,
  ).run(secId, symbol, symbol);
  db.prepare(
    `INSERT INTO positions (id, snapshot_id, security_id, quantity, price, market_value) VALUES (?, ?, ?, 10, 100, 1000)`,
  ).run(`pos_${snapshotId}`, snapshotId, secId);
}

describe("schwab account to flavor mapping", () => {
  it("puts each schwab account in exactly one flavor", () => {
    for (const row of SCHWAB_FLAVOR_MAP) {
      assert.deepEqual(flavorsContaining(row.id), [row.flavor], row.id);
    }
  });

  it("keeps other schwab accounts on main only", () => {
    for (const id of ["schwab_1", "schwab_999", "schwab_00000000"]) {
      assert.deepEqual(flavorsContaining(id), ["main"]);
      assert.equal(isAccountInFlavor("rorie", id), false);
      assert.equal(isAccountInFlavor("peyton", id), false);
    }
  });
});

describe("peyton scoped queries", () => {
  it("latest snapshots for peyton are only schwab_50138076", () => {
    const db = createTestDb();
    seedAccount(db, "schwab_11111111", "snap_main");
    seedAccount(db, RORIE_ACCOUNT_ID, "snap_rorie");
    seedAccount(db, PEYTON_ACCOUNT_ID, "snap_peyton");
    seedAccount(db, "manual_ext", "snap_manual");
    db.prepare(
      `INSERT INTO institution_connections (id, type, display_name, status) VALUES ('conn_manual', 'manual', 'Manual', 'active')`,
    ).run();
    db.prepare(`UPDATE accounts SET connection_id = 'conn_manual', type = 'manual' WHERE id = 'manual_ext'`).run();
    seedAccount(db, "demo_x", "snap_demo");

    assert.deepEqual(latestSnapshotIds(db, "all_synced", "peyton"), ["snap_peyton"]);
    assert.deepEqual(latestSnapshotIds(db, "schwab_only", "peyton"), ["snap_peyton"]);
    assert.deepEqual(latestSnapshotIds(db, "all_synced", "rorie"), ["snap_rorie"]);

    const mainIds = latestSnapshotIds(db, "all_synced", "main").sort();
    assert.deepEqual(mainIds, ["snap_main", "snap_manual"]);
    assert.equal(mainIds.includes("snap_rorie"), false);
    assert.equal(mainIds.includes("snap_peyton"), false);
    assert.equal(mainIds.includes("snap_demo"), false);
  });

  it("dividend book scopes peyton without moving the main and rorie book", () => {
    const db = createTestDb();
    seedAccount(db, "schwab_11111111", "snap_main");
    seedAccount(db, RORIE_ACCOUNT_ID, "snap_rorie");
    seedAccount(db, PEYTON_ACCOUNT_ID, "snap_peyton");
    seedEquity(db, "snap_main", "MAIN");
    seedEquity(db, "snap_rorie", "RORIE");
    seedEquity(db, "snap_peyton", "PEYT");

    const legacy = loadLatestSchwabPositionRows(db).map((r) => r.accountId).sort();
    const mainBook = loadLatestSchwabPositionRows(db, "main").map((r) => r.accountId).sort();
    const rorieBook = loadLatestSchwabPositionRows(db, "rorie").map((r) => r.accountId).sort();
    const peytonBook = loadLatestSchwabPositionRows(db, "peyton").map((r) => r.accountId);

    assert.deepEqual(legacy, ["schwab_11111111", RORIE_ACCOUNT_ID]);
    assert.deepEqual(mainBook, legacy);
    assert.deepEqual(rorieBook, legacy);
    assert.deepEqual(peytonBook, [PEYTON_ACCOUNT_ID]);
    assert.match(dividendAccountWhereSql("main"), /schwab_%/);
    assert.match(dividendAccountWhereSql("peyton"), new RegExp(`IN \\('${PEYTON_ACCOUNT_ID}'\\)`));
  });
});

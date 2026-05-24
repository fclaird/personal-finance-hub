import fs from "node:fs";
import path from "node:path";

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";

import { latestSnapshotIds } from "@/lib/holdings/latestSnapshots";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  const schemaPath = path.join(process.cwd(), "src", "db", "schema.sql");
  db.exec(fs.readFileSync(schemaPath, "utf-8"));
  return db;
}

function loadPositionRows(db: Database.Database, snapshotIds: string[]) {
  return db
    .prepare(
      `
      SELECT
        s.security_type AS security_type,
        s.symbol AS symbol,
        SUM(p.quantity) AS quantity,
        SUM(COALESCE(p.market_value, 0)) AS market_value
      FROM positions p
      JOIN securities s ON s.id = p.security_id
      WHERE p.snapshot_id IN (SELECT value FROM json_each(@snaps))
      GROUP BY s.id, s.security_type, s.symbol
    `,
    )
    .all({ snaps: JSON.stringify(snapshotIds) }) as Array<{
    security_type: string;
    symbol: string | null;
    quantity: number;
    market_value: number;
  }>;
}

describe("portfolioGlance snapshot selection", () => {
  it("prefers all_synced snapshots and aggregates cash with equities", () => {
    const db = createTestDb();
    db.prepare(
      `INSERT INTO institution_connections (id, type, display_name, status) VALUES ('c1', 'schwab', 'S', 'active')`,
    ).run();
    db.prepare(
      `INSERT INTO accounts (id, connection_id, name, account_bucket, type) VALUES ('schwab_a', 'c1', 'Taxable', 'brokerage', 'brokerage')`,
    ).run();
    db.prepare(`INSERT INTO holding_snapshots (id, account_id, as_of) VALUES ('snap1', 'schwab_a', '2025-06-01')`).run();
    db.prepare(`INSERT INTO securities (id, symbol, name, security_type) VALUES ('sec_cash', 'CASH', 'Cash', 'cash')`).run();
    db.prepare(`INSERT INTO securities (id, symbol, name, security_type) VALUES ('sec_vti', 'VTI', 'VTI', 'equity')`).run();
    db.prepare(
      `INSERT INTO positions (id, snapshot_id, security_id, quantity, price, market_value) VALUES ('p_cash', 'snap1', 'sec_cash', 1, 500, 500)`,
    ).run();
    db.prepare(
      `INSERT INTO positions (id, snapshot_id, security_id, quantity, price, market_value) VALUES ('p_vti', 'snap1', 'sec_vti', 10, 100, 1000)`,
    ).run();

    const snapshotIds = latestSnapshotIds(db, "all_synced");
    assert.deepEqual(snapshotIds, ["snap1"]);

    const rows = loadPositionRows(db, snapshotIds);
    const cashMv = rows.find((r) => r.security_type === "cash")?.market_value ?? 0;
    const equityMv = rows.find((r) => r.symbol === "VTI")?.market_value ?? 0;
    assert.equal(cashMv, 500);
    assert.equal(equityMv, 1000);
    assert.equal(cashMv + equityMv, 1500);
  });

  it("returns empty snapshot list when no accounts exist", () => {
    const db = createTestDb();
    assert.deepEqual(latestSnapshotIds(db, "all_synced"), []);
  });
});

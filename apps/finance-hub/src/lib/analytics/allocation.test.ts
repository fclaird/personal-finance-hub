import fs from "node:fs";
import path from "node:path";

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";

import { bucketFromAccount } from "@/lib/accountBuckets";
import { classifyAsset } from "@/lib/analytics/assetClass";
import { getConsolidatedAllocation } from "@/lib/analytics/allocation";
import { latestSnapshotIds } from "@/lib/holdings/latestSnapshots";
import { POSITION_MARKET_VALUE_SQL } from "@/lib/holdings/positionMarketValue";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  const schemaPath = path.join(process.cwd(), "src", "db", "schema.sql");
  db.exec(fs.readFileSync(schemaPath, "utf-8"));
  return db;
}

function aggregateMvByBucket(db: Database.Database): Map<string, number> {
  const snapshotIdSet = new Set(latestSnapshotIds(db, "all_synced"));
  const snapshots = db
    .prepare(
      `
      SELECT a.name, a.nickname, a.account_bucket, hs.id AS snapshot_id
      FROM accounts a
      JOIN holding_snapshots hs ON hs.account_id = a.id
      WHERE hs.as_of = (SELECT MAX(hs2.as_of) FROM holding_snapshots hs2 WHERE hs2.account_id = a.id)
    `,
    )
    .all() as Array<{ name: string; nickname: string | null; account_bucket: string | null; snapshot_id: string }>;

  const byBucket = new Map<string, number>();
  for (const s of snapshots) {
    if (!snapshotIdSet.has(s.snapshot_id)) continue;
    const bucket = bucketFromAccount(s.name, s.nickname, s.account_bucket);
    const row = db
      .prepare(
        `SELECT COALESCE(SUM(p.market_value), 0) AS mv FROM positions p WHERE p.snapshot_id = ?`,
      )
      .get(s.snapshot_id) as { mv: number };
    byBucket.set(bucket, (byBucket.get(bucket) ?? 0) + row.mv);
  }
  return byBucket;
}

describe("allocation bucket splits", () => {
  it("529 holdings stay in 529 bucket, not brokerage or retirement", () => {
    const db = createTestDb();
    db.prepare(
      `INSERT INTO institution_connections (id, type, display_name, status) VALUES ('c1', 'schwab', 'S', 'active')`,
    ).run();
    db.prepare(
      `INSERT INTO institution_connections (id, type, display_name, status) VALUES ('conn_manual', 'manual', 'M', 'active')`,
    ).run();

    for (const [id, bucket, snap, mv] of [
      ["schwab_tax", "brokerage", "s1", 1000],
      ["schwab_ira", "retirement", "s2", 2000],
      ["manual_529", "529", "s3", 500],
    ] as const) {
      db.prepare(
        `INSERT INTO accounts (id, connection_id, name, account_bucket, type) VALUES (?, ?, ?, ?, 'brokerage')`,
      ).run(id, id.startsWith("manual") ? "conn_manual" : "c1", id, bucket);
      db.prepare(`INSERT INTO holding_snapshots (id, account_id, as_of) VALUES (?, ?, '2025-06-01')`).run(snap, id);
      db.prepare(`INSERT INTO securities (id, symbol, name, security_type) VALUES ('sec_${snap}', 'VTI', 'VTI', 'equity')`).run();
      db.prepare(
        `INSERT INTO positions (id, snapshot_id, security_id, quantity, price, market_value) VALUES (?, ?, ?, 1, ?, ?)`,
      ).run(`pos_${snap}`, snap, `sec_${snap}`, mv, mv);
    }

    const buckets = aggregateMvByBucket(db);
    assert.equal(buckets.get("brokerage"), 1000);
    assert.equal(buckets.get("retirement"), 2000);
    assert.equal(buckets.get("529"), 500);
  });

  it("consolidated allocation aggregates latest snapshot per account", () => {
    const db = createTestDb();
    db.prepare(
      `INSERT INTO institution_connections (id, type, display_name, status) VALUES ('c1', 'schwab', 'S', 'active')`,
    ).run();
    db.prepare(
      `INSERT INTO institution_connections (id, type, display_name, status) VALUES ('conn_manual', 'manual', 'M', 'active')`,
    ).run();

    db.prepare(
      `INSERT INTO accounts (id, connection_id, name, account_bucket, type) VALUES ('schwab_a', 'c1', 'Taxable', 'brokerage', 'brokerage')`,
    ).run();
    db.prepare(
      `INSERT INTO accounts (id, connection_id, name, account_bucket, type) VALUES ('manual_b', 'conn_manual', '529', '529', 'manual')`,
    ).run();

    db.prepare(`INSERT INTO holding_snapshots (id, account_id, as_of) VALUES ('snap_old', 'schwab_a', '2025-01-01')`).run();
    db.prepare(`INSERT INTO holding_snapshots (id, account_id, as_of) VALUES ('snap_new', 'schwab_a', '2025-06-01')`).run();
    db.prepare(`INSERT INTO holding_snapshots (id, account_id, as_of) VALUES ('snap_manual', 'manual_b', '2025-03-01')`).run();

    db.prepare(`INSERT INTO securities (id, symbol, name, security_type) VALUES ('sec_A', 'AAPL', 'AAPL', 'equity')`).run();
    db.prepare(`INSERT INTO securities (id, symbol, name, security_type) VALUES ('sec_B', 'VTI', 'VTI', 'equity')`).run();

    db.prepare(
      `INSERT INTO positions (id, snapshot_id, security_id, quantity, price, market_value) VALUES ('p_old', 'snap_old', 'sec_A', 1, 100, 100)`,
    ).run();
    db.prepare(
      `INSERT INTO positions (id, snapshot_id, security_id, quantity, price, market_value) VALUES ('p_new', 'snap_new', 'sec_A', 1, 100, 1000)`,
    ).run();
    db.prepare(
      `INSERT INTO positions (id, snapshot_id, security_id, quantity, price, market_value) VALUES ('p_manual', 'snap_manual', 'sec_B', 1, 100, 250)`,
    ).run();

    const snapshotIds = latestSnapshotIds(db, "all_synced");
    assert.deepEqual(snapshotIds.sort(), ["snap_manual", "snap_new"]);

    const rows = db
      .prepare(
        `
        SELECT COALESCE(SUM(p.market_value), 0) AS mv
        FROM positions p
        JOIN holding_snapshots hs ON hs.id = p.snapshot_id
        JOIN accounts a ON a.id = hs.account_id
        JOIN securities s ON s.id = p.security_id
        WHERE p.snapshot_id IN (SELECT value FROM json_each(@snaps))
          AND (s.security_type != 'cash' OR a.id LIKE 'manual_%')
      `,
      )
      .get({ snaps: JSON.stringify(snapshotIds) }) as { mv: number };

    assert.equal(rows.mv, 1250);
  });

  it("synthetic allocation replaces option marks with delta equity exposure", () => {
    const db = createTestDb();
    db.prepare(
      `INSERT INTO institution_connections (id, type, display_name, status) VALUES ('c1', 'schwab', 'S', 'active')`,
    ).run();
    db.prepare(
      `INSERT INTO accounts (id, connection_id, name, account_bucket, type) VALUES ('schwab_a', 'c1', 'Taxable', 'brokerage', 'brokerage')`,
    ).run();
    db.prepare(`INSERT INTO holding_snapshots (id, account_id, as_of) VALUES ('snap_new', 'schwab_a', '2025-06-01')`).run();

    db.prepare(`INSERT INTO securities (id, symbol, name, security_type) VALUES ('sec_AAPL', 'AAPL', 'AAPL', 'equity')`).run();
    db.prepare(
      `INSERT INTO securities (id, symbol, name, security_type, underlying_security_id) VALUES ('sec_AAPL_CALL', 'AAPL 250620C00100000', 'AAPL Call', 'option', 'sec_AAPL')`,
    ).run();
    db.prepare(
      `INSERT INTO positions (id, snapshot_id, security_id, quantity, price, market_value) VALUES ('p_stock', 'snap_new', 'sec_AAPL', 10, 100, 1000)`,
    ).run();
    db.prepare(
      `INSERT INTO positions (id, snapshot_id, security_id, quantity, price, market_value) VALUES ('p_call', 'snap_new', 'sec_AAPL_CALL', 1, 2, 200)`,
    ).run();
    db.prepare(`INSERT INTO option_greeks (id, position_id, delta) VALUES ('g_call', 'p_call', 0.5)`).run();

    const withoutSynthetic = getConsolidatedAllocation(false, "auto", new Map([["AAPL", 100]]), db);
    assert.equal(withoutSynthetic.totalMarketValue, 1200);
    assert.equal(withoutSynthetic.byAssetClass.find((b) => b.key === "option")?.marketValue, 200);

    const withSynthetic = getConsolidatedAllocation(true, "auto", new Map([["AAPL", 100]]), db);
    assert.equal(withSynthetic.totalMarketValue, 6000);
    assert.equal(withSynthetic.byAssetClass.find((b) => b.key === "equity")?.marketValue, 6000);
    assert.equal(withSynthetic.byAssetClass.find((b) => b.key === "option"), undefined);
  });

  it("manual fund holdings classify as fund and count in schwab_only scope", () => {
    const db = createTestDb();
    db.prepare(
      `INSERT INTO institution_connections (id, type, display_name, status) VALUES ('conn_manual', 'manual', 'M', 'active')`,
    ).run();
    db.prepare(
      `INSERT INTO accounts (id, connection_id, name, account_bucket, type) VALUES ('manual_f', 'conn_manual', 'Fidelity', 'brokerage', 'manual')`,
    ).run();
    db.prepare(`INSERT INTO holding_snapshots (id, account_id, as_of) VALUES ('snap_f', 'manual_f', '2025-06-01')`).run();
    db.prepare(`INSERT INTO securities (id, symbol, name, security_type) VALUES ('sec_FSKAX', 'FSKAX', 'FSKAX', 'fund')`).run();
    db.prepare(
      `INSERT INTO positions (id, snapshot_id, security_id, quantity, price, market_value, metadata_json) VALUES ('p_f', 'snap_f', 'sec_FSKAX', 100, 120, NULL, '{"source":"manual"}')`,
    ).run();

    const snapshotIds = latestSnapshotIds(db, "schwab_only");
    assert.deepEqual(snapshotIds, ["snap_f"]);

    const row = db
      .prepare(
        `
        SELECT s.security_type, ${POSITION_MARKET_VALUE_SQL} AS market_value, p.metadata_json
        FROM positions p
        JOIN securities s ON s.id = p.security_id
        WHERE p.snapshot_id IN (SELECT value FROM json_each(@snaps))
      `,
      )
      .get({ snaps: JSON.stringify(snapshotIds) }) as {
      security_type: string;
      market_value: number;
      metadata_json: string;
    };

    assert.equal(classifyAsset(row.security_type, row.metadata_json), "fund");
    assert.equal(row.market_value, 12000);
  });
});

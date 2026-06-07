import fs from "node:fs";
import path from "node:path";

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";

import { getUnderlyingExposureByBucket } from "@/lib/analytics/optionsExposure";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  const schemaPath = path.join(process.cwd(), "src", "db", "schema.sql");
  db.exec(fs.readFileSync(schemaPath, "utf-8"));
  return db;
}

function seedSharedSymbolExposure(db: Database.Database) {
  db.prepare(
    `INSERT INTO institution_connections (id, type, display_name, status) VALUES ('c1', 'schwab', 'S', 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO institution_connections (id, type, display_name, status) VALUES ('conn_manual', 'manual', 'M', 'active')`,
  ).run();

  db.prepare(
    `INSERT INTO accounts (id, connection_id, name, account_bucket, type) VALUES ('schwab_tax', 'c1', 'Taxable', 'brokerage', 'brokerage')`,
  ).run();
  db.prepare(
    `INSERT INTO accounts (id, connection_id, name, account_bucket, type) VALUES ('manual_529', 'conn_manual', '529 Plan', '529', 'manual')`,
  ).run();

  db.prepare(`INSERT INTO holding_snapshots (id, account_id, as_of) VALUES ('snap_broker', 'schwab_tax', '2025-06-01')`).run();
  db.prepare(`INSERT INTO holding_snapshots (id, account_id, as_of) VALUES ('snap_529', 'manual_529', '2025-06-01')`).run();

  db.prepare(
    `INSERT INTO securities (id, symbol, name, security_type) VALUES ('sec_broker', 'VTI', 'VTI', 'equity')`,
  ).run();
  db.prepare(
    `INSERT INTO securities (id, symbol, name, security_type) VALUES ('sec_529', 'VTI', 'VTI', 'fund')`,
  ).run();

  // Brokerage: 10 shares at stale $100 snapshot MV; live mark will be $150.
  db.prepare(
    `INSERT INTO positions (id, snapshot_id, security_id, quantity, price, market_value) VALUES ('pos_broker', 'snap_broker', 'sec_broker', 10, 100, 1000)`,
  ).run();
  // 529 plan fund: synthetic shares with statement-anchored MV (must not use qty × live NAV).
  db.prepare(
    `INSERT INTO positions (id, snapshot_id, security_id, quantity, price, market_value, metadata_json) VALUES ('pos_529', 'snap_529', 'sec_529', 50, 1, 5000, '{"source":"manual","purchaseDate":null,"fundBasis":{"statementMarketValue":5000,"statementDate":"2025-01-01","basisTickerNav":100}}')`,
  ).run();
}

describe("getUnderlyingExposureByBucket plan fund re-marking", () => {
  it("re-marks brokerage holdings when the same symbol is also a 529 plan fund", () => {
    const db = createTestDb();
    seedSharedSymbolExposure(db);

    const liveMarks = new Map([["VTI", 150]]);
    const buckets = getUnderlyingExposureByBucket("all_synced", liveMarks, db);

    const brokerage = buckets.find((b) => b.bucketKey === "brokerage");
    const plan529 = buckets.find((b) => b.bucketKey === "529");
    assert.ok(brokerage);
    assert.ok(plan529);

    const brokerVti = brokerage.exposure.find((r) => r.underlyingSymbol === "VTI");
    const planVti = plan529.exposure.find((r) => r.underlyingSymbol === "VTI");
    assert.ok(brokerVti);
    assert.ok(planVti);

    assert.equal(brokerVti.spotMarketValue, 1500);
    assert.equal(planVti.spotMarketValue, 5000);
    assert.equal(planVti.heldShares, 0);
  });
});

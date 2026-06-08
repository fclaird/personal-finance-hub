import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";

import { getUnderlyingExposureByBucket } from "./optionsExposure";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  const schemaPath = path.join(process.cwd(), "src", "db", "schema.sql");
  db.exec(fs.readFileSync(schemaPath, "utf-8"));
  return db;
}

test("plan fund live-mark skip does not suppress brokerage option exposure for same ticker", () => {
  const db = createTestDb();
  db.prepare(
    `INSERT INTO institution_connections (id, type, display_name, status) VALUES ('conn_manual', 'manual', 'Manual', 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO institution_connections (id, type, display_name, status) VALUES ('conn_schwab', 'schwab', 'Schwab', 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO accounts (id, connection_id, name, account_bucket, type) VALUES ('manual_529', 'conn_manual', '529', '529', 'manual')`,
  ).run();
  db.prepare(
    `INSERT INTO accounts (id, connection_id, name, account_bucket, type) VALUES ('schwab_tax', 'conn_schwab', 'Taxable', 'brokerage', 'brokerage')`,
  ).run();
  db.prepare(`INSERT INTO holding_snapshots (id, account_id, as_of) VALUES ('snap_529', 'manual_529', '2026-06-01')`).run();
  db.prepare(`INSERT INTO holding_snapshots (id, account_id, as_of) VALUES ('snap_tax', 'schwab_tax', '2026-06-01')`).run();
  db.prepare(`INSERT INTO securities (id, symbol, name, security_type) VALUES ('sec_vti_fund', 'VTI', 'VTI Plan', 'fund')`).run();
  db.prepare(`INSERT INTO securities (id, symbol, name, security_type) VALUES ('sec_vti_stock', 'VTI', 'VTI', 'equity')`).run();
  db.prepare(
    `INSERT INTO securities (id, symbol, name, security_type, underlying_security_id)
     VALUES ('sec_vti_call', 'VTI  260116C00200000', 'VTI Call', 'option', 'sec_vti_stock')`,
  ).run();
  db.prepare(
    `INSERT INTO positions (id, snapshot_id, security_id, quantity, price, market_value)
     VALUES ('pos_529', 'snap_529', 'sec_vti_fund', 1000, 100, 500000)`,
  ).run();
  db.prepare(
    `INSERT INTO positions (id, snapshot_id, security_id, quantity, price, market_value)
     VALUES ('pos_call', 'snap_tax', 'sec_vti_call', 2, 10, 2000)`,
  ).run();
  db.prepare(
    `INSERT INTO option_greeks (id, position_id, delta) VALUES ('greeks_call', 'pos_call', 0.5)`,
  ).run();

  const buckets = getUnderlyingExposureByBucket("auto", new Map([["VTI", 200]]), db);
  const brokerageVti = buckets
    .find((bucket) => bucket.bucketKey === "brokerage")
    ?.exposure.find((row) => row.underlyingSymbol === "VTI");
  const planVti = buckets
    .find((bucket) => bucket.bucketKey === "529")
    ?.exposure.find((row) => row.underlyingSymbol === "VTI");

  assert.ok(brokerageVti);
  assert.equal(brokerageVti.syntheticShares, 100);
  assert.equal(brokerageVti.syntheticMarketValue, 20_000);
  assert.ok(planVti);
  assert.equal(planVti.spotMarketValue, 500_000);
});

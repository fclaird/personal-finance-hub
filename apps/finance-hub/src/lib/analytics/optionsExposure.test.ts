import fs from "node:fs";
import path from "node:path";

import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";

import { getUnderlyingExposureByBucket } from "@/lib/analytics/optionsExposure";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  const schemaPath = path.join(process.cwd(), "src", "db", "schema.sql");
  db.exec(fs.readFileSync(schemaPath, "utf-8"));
  return db;
}

test("529 holdings preserve spot MV without suppressing same-ticker brokerage option exposure", () => {
  const db = createTestDb();
  db.prepare(
    `INSERT INTO institution_connections (id, type, display_name, status) VALUES ('conn_manual', 'manual', 'Manual', 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO institution_connections (id, type, display_name, status) VALUES ('conn_schwab', 'schwab', 'Schwab', 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO accounts (id, connection_id, name, account_bucket, type) VALUES ('manual_529', 'conn_manual', 'Plan', '529', 'manual')`,
  ).run();
  db.prepare(
    `INSERT INTO accounts (id, connection_id, name, account_bucket, type) VALUES ('schwab_taxable', 'conn_schwab', 'Taxable', 'brokerage', 'brokerage')`,
  ).run();
  db.prepare(`INSERT INTO holding_snapshots (id, account_id, as_of) VALUES ('snap_529', 'manual_529', '2026-06-01')`).run();
  db.prepare(
    `INSERT INTO holding_snapshots (id, account_id, as_of) VALUES ('snap_brokerage', 'schwab_taxable', '2026-06-01')`,
  ).run();
  db.prepare(`INSERT INTO securities (id, symbol, name, security_type) VALUES ('sec_vti', 'VTI', 'VTI', 'equity')`).run();
  db.prepare(
    `INSERT INTO securities (id, symbol, name, security_type, underlying_security_id) VALUES ('sec_vti_call', 'VTI 2026 C 250', 'VTI Call', 'option', 'sec_vti')`,
  ).run();
  db.prepare(
    `INSERT INTO positions (id, snapshot_id, security_id, quantity, price, market_value, metadata_json) VALUES ('pos_529', 'snap_529', 'sec_vti', 100, 100, 50000, '{"source":"manual"}')`,
  ).run();
  db.prepare(
    `INSERT INTO positions (id, snapshot_id, security_id, quantity, price, market_value) VALUES ('pos_stock', 'snap_brokerage', 'sec_vti', 10, 100, 1000)`,
  ).run();
  db.prepare(
    `INSERT INTO positions (id, snapshot_id, security_id, quantity, price, market_value) VALUES ('pos_call', 'snap_brokerage', 'sec_vti_call', -1, 10, -1000)`,
  ).run();
  db.prepare(`INSERT INTO option_greeks (id, position_id, delta) VALUES ('greek_call', 'pos_call', 0.5)`).run();

  const buckets = getUnderlyingExposureByBucket("auto", new Map([["VTI", 250]]), db);
  const planRow = buckets.find((b) => b.bucketKey === "529")?.exposure.find((r) => r.underlyingSymbol === "VTI");
  const brokerageRow = buckets.find((b) => b.bucketKey === "brokerage")?.exposure.find((r) => r.underlyingSymbol === "VTI");

  assert.equal(planRow?.spotMarketValue, 50_000);
  assert.equal(planRow?.syntheticMarketValue, 0);
  assert.equal(brokerageRow?.spotMarketValue, 2_500);
  assert.equal(brokerageRow?.syntheticShares, -50);
  assert.equal(brokerageRow?.syntheticMarketValue, -12_500);
});

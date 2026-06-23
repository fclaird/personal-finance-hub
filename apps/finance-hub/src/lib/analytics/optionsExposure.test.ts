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

test("plan fund preservation does not suppress same-ticker brokerage/options live exposure", () => {
  const db = createTestDb();
  db.prepare(
    `INSERT INTO institution_connections (id, type, display_name, status) VALUES ('c1', 'schwab', 'S', 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO institution_connections (id, type, display_name, status) VALUES ('conn_manual', 'manual', 'M', 'active')`,
  ).run();

  db.prepare(
    `INSERT INTO accounts (id, connection_id, name, account_bucket, type) VALUES ('schwab_taxable', 'c1', 'Taxable', 'brokerage', 'brokerage')`,
  ).run();
  db.prepare(
    `INSERT INTO accounts (id, connection_id, name, account_bucket, type) VALUES ('manual_529', 'conn_manual', '529 Plan', '529', 'manual')`,
  ).run();

  db.prepare(
    `INSERT INTO holding_snapshots (id, account_id, as_of) VALUES ('snap_brokerage', 'schwab_taxable', '2026-06-01')`,
  ).run();
  db.prepare(
    `INSERT INTO holding_snapshots (id, account_id, as_of) VALUES ('snap_529', 'manual_529', '2026-06-01')`,
  ).run();

  db.prepare(
    `INSERT INTO securities (id, symbol, name, security_type) VALUES ('sec_VTI', 'VTI', 'VTI', 'equity')`,
  ).run();
  db.prepare(
    `INSERT INTO securities (id, symbol, name, security_type) VALUES ('sec_VTI_PLAN', 'VTI', 'VTI Plan Proxy', 'fund')`,
  ).run();
  db.prepare(
    `
      INSERT INTO securities (id, symbol, name, security_type, underlying_security_id)
      VALUES ('sec_VTI_CALL', 'VTI   260717C00100000', 'VTI Call', 'option', 'sec_VTI')
    `,
  ).run();

  db.prepare(
    `INSERT INTO positions (id, snapshot_id, security_id, quantity, price, market_value) VALUES ('pos_stock', 'snap_brokerage', 'sec_VTI', 10, 90, 900)`,
  ).run();
  db.prepare(
    `INSERT INTO positions (id, snapshot_id, security_id, quantity, price, market_value) VALUES ('pos_call', 'snap_brokerage', 'sec_VTI_CALL', 1, 2, 200)`,
  ).run();
  db.prepare(
    `INSERT INTO option_greeks (id, position_id, delta) VALUES ('greek_call', 'pos_call', 0.5)`,
  ).run();
  db.prepare(
    `
      INSERT INTO positions (id, snapshot_id, security_id, quantity, price, market_value, metadata_json)
      VALUES ('pos_plan', 'snap_529', 'sec_VTI_PLAN', 1000, NULL, 25000, '{"source":"manual"}')
    `,
  ).run();

  const buckets = getUnderlyingExposureByBucket("auto", new Map([["VTI", 100]]), db);
  const brokerage = buckets.find((b) => b.bucketKey === "brokerage")?.exposure.find((r) => r.underlyingSymbol === "VTI");
  const plan529 = buckets.find((b) => b.bucketKey === "529")?.exposure.find((r) => r.underlyingSymbol === "VTI");

  assert.ok(brokerage);
  assert.equal(brokerage.spotMarketValue, 1000);
  assert.equal(brokerage.syntheticShares, 50);
  assert.equal(brokerage.syntheticMarketValue, 5000);

  assert.ok(plan529);
  assert.equal(plan529.spotMarketValue, 25000);
  assert.equal(plan529.syntheticMarketValue, 0);
});

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
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

test("plan fund skip does not block live re-marking for the same symbol in other buckets", () => {
  const db = createTestDb();
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
  db.prepare(`INSERT INTO holding_snapshots (id, account_id, as_of) VALUES ('snap_broker', 'schwab_tax', '2026-05-28')`).run();
  db.prepare(`INSERT INTO holding_snapshots (id, account_id, as_of) VALUES ('snap_529', 'manual_529', '2026-05-28')`).run();
  db.prepare(`INSERT INTO securities (id, symbol, name, security_type) VALUES ('sec_vti', 'VTI', 'VTI', 'equity')`).run();
  db.prepare(`INSERT INTO securities (id, symbol, name, security_type) VALUES ('sec_fund', 'VTIAX', 'VTIAX', 'fund')`).run();
  db.prepare(
    `INSERT INTO positions (id, snapshot_id, security_id, quantity, price, market_value) VALUES ('pos_broker', 'snap_broker', 'sec_vti', 100, 200, 20000)`,
  ).run();
  db.prepare(
    `INSERT INTO positions (id, snapshot_id, security_id, quantity, price, market_value, metadata_json) VALUES ('pos_529', 'snap_529', 'sec_fund', 1618, 120, 194528, '{"source":"manual","purchaseDate":"2026-05-01","fundBasis":{"statementMarketValue":194528,"statementDate":"2026-05-01","basisTickerNav":354}}')`,
  ).run();

  const liveMarks = new Map([["VTI", 250], ["VTIAX", 368]]);
  const buckets = getUnderlyingExposureByBucket("auto", liveMarks, db);

  const brokerage = buckets.find((b) => b.bucketKey === "brokerage");
  const plan529 = buckets.find((b) => b.bucketKey === "529");
  assert.ok(brokerage);
  assert.ok(plan529);

  const brokerVti = brokerage!.exposure.find((row) => row.underlyingSymbol === "VTI");
  const planVtiax = plan529!.exposure.find((row) => row.underlyingSymbol === "VTIAX");
  assert.ok(brokerVti);
  assert.ok(planVtiax);

  assert.equal(brokerVti!.spotMarketValue, 25000);
  assert.equal(planVtiax!.spotMarketValue, 194528);
});

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

test("plan fund skip does not block live re-mark for the same symbol in other buckets", () => {
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
    `INSERT INTO accounts (id, connection_id, name, account_bucket, type) VALUES ('manual_529', 'conn_manual', '529', '529', 'manual')`,
  ).run();
  db.prepare(`INSERT INTO holding_snapshots (id, account_id, as_of) VALUES ('snap_b', 'schwab_tax', '2026-05-28')`).run();
  db.prepare(`INSERT INTO holding_snapshots (id, account_id, as_of) VALUES ('snap_529', 'manual_529', '2026-05-28')`).run();
  db.prepare(`INSERT INTO securities (id, symbol, name, security_type) VALUES ('sec_ffnox', 'FFNOX', 'FFNOX', 'fund')`).run();
  db.prepare(
    `INSERT INTO positions (id, snapshot_id, security_id, quantity, price, market_value, metadata_json) VALUES ('p_b', 'snap_b', 'sec_ffnox', 1000, 100, 100000, NULL)`,
  ).run();
  db.prepare(
    `INSERT INTO positions (id, snapshot_id, security_id, quantity, price, market_value, metadata_json) VALUES ('p_529', 'snap_529', 'sec_ffnox', 1, 250000, 250000, '{"source":"manual","fundBasis":{"statementMarketValue":250000,"statementDate":"2026-05-01","basisTickerNav":354}}')`,
  ).run();

  const livePx = 110;
  const buckets = getUnderlyingExposureByBucket("auto", new Map([["FFNOX", livePx]]), db);
  const brokerage = buckets.find((b) => b.bucketKey === "brokerage")?.exposure.find((e) => e.underlyingSymbol === "FFNOX");
  const plan529 = buckets.find((b) => b.bucketKey === "529")?.exposure.find((e) => e.underlyingSymbol === "FFNOX");

  assert.ok(brokerage);
  assert.ok(plan529);
  assert.equal(brokerage!.spotMarketValue, 1000 * livePx);
  assert.equal(plan529!.spotMarketValue, 250000);
});

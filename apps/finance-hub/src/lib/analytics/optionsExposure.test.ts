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

test("plan/529 fund symbols only skip live re-mark within their own bucket rows", () => {
  const db = createTestDb();
  db.prepare(
    `INSERT INTO institution_connections (id, type, display_name, status) VALUES ('conn_manual', 'manual', 'Manual', 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO institution_connections (id, type, display_name, status) VALUES ('c1', 'schwab', 'S', 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO accounts (id, connection_id, name, account_bucket, type) VALUES ('manual_529', 'conn_manual', '529 Plan', '529', 'manual')`,
  ).run();
  db.prepare(
    `INSERT INTO accounts (id, connection_id, name, account_bucket, type) VALUES ('schwab_ira', 'c1', 'IRA', 'retirement', 'brokerage')`,
  ).run();
  db.prepare(`INSERT INTO holding_snapshots (id, account_id, as_of) VALUES ('snap529', 'manual_529', '2026-05-28')`).run();
  db.prepare(`INSERT INTO holding_snapshots (id, account_id, as_of) VALUES ('snapIra', 'schwab_ira', '2026-05-28')`).run();
  db.prepare(
    `INSERT INTO securities (id, symbol, name, security_type) VALUES ('sec_fxaix', 'FXAIX', 'FXAIX', 'fund')`,
  ).run();
  db.prepare(
    `INSERT INTO positions (id, snapshot_id, security_id, quantity, price, market_value, metadata_json)
     VALUES ('p529', 'snap529', 'sec_fxaix', 1618, 120, 250000, '{"source":"manual","purchaseDate":"2024-01-01","fundBasis":{"statementMarketValue":250000,"statementDate":"2024-01-01","basisTickerNav":120}}')`,
  ).run();
  db.prepare(
    `INSERT INTO positions (id, snapshot_id, security_id, quantity, price, market_value)
     VALUES ('pIra', 'snapIra', 'sec_fxaix', 100, 100, 10000)`,
  ).run();

  const livePx = 150;
  const buckets = getUnderlyingExposureByBucket("auto", new Map([["FXAIX", livePx]]), db);

  const bucket529 = buckets.find((b) => b.bucketKey === "529");
  const bucketRetirement = buckets.find((b) => b.bucketKey === "retirement");
  const fxaix529 = bucket529?.exposure.find((r) => r.underlyingSymbol === "FXAIX");
  const fxaixIra = bucketRetirement?.exposure.find((r) => r.underlyingSymbol === "FXAIX");

  assert.equal(fxaix529?.spotMarketValue, 250_000);
  assert.equal(fxaixIra?.spotMarketValue, 100 * livePx);
});

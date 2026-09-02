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

function seedSharedSymbolExposure(db: Database.Database) {
  db.prepare(
    `INSERT INTO institution_connections (id, type, display_name, status) VALUES ('conn_manual', 'manual', 'Manual', 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO institution_connections (id, type, display_name, status) VALUES ('c1', 'schwab', 'S', 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO accounts (id, connection_id, name, account_bucket, type) VALUES ('manual_529', 'conn_manual', '529', '529', 'manual')`,
  ).run();
  db.prepare(
    `INSERT INTO accounts (id, connection_id, name, account_bucket, type) VALUES ('schwab_b', 'c1', 'Taxable', 'brokerage', 'brokerage')`,
  ).run();
  db.prepare(`INSERT INTO holding_snapshots (id, account_id, as_of) VALUES ('snap529', 'manual_529', '2026-05-22')`).run();
  db.prepare(`INSERT INTO holding_snapshots (id, account_id, as_of) VALUES ('snapBr', 'schwab_b', '2026-05-22')`).run();
  db.prepare(`INSERT INTO securities (id, symbol, name, security_type) VALUES ('sec_vti_529', 'VTI', 'VTI 529', 'fund')`).run();
  db.prepare(`INSERT INTO securities (id, symbol, name, security_type) VALUES ('sec_vti_br', 'VTI', 'VTI', 'equity')`).run();
  db.prepare(
    `INSERT INTO positions (id, snapshot_id, security_id, quantity, price, market_value) VALUES ('p529', 'snap529', 'sec_vti_529', 100, 200, 20000)`,
  ).run();
  db.prepare(
    `INSERT INTO positions (id, snapshot_id, security_id, quantity, price, market_value) VALUES ('pBr', 'snapBr', 'sec_vti_br', 10, 200, 2000)`,
  ).run();
}

test("getUnderlyingExposureByBucket scopes plan-fund skip to bucket", () => {
  const db = createTestDb();
  seedSharedSymbolExposure(db);

  const livePx = 250;
  const buckets = getUnderlyingExposureByBucket("auto", new Map([["VTI", livePx]]), "main", db);

  const brokerage = buckets.find((b) => b.bucketKey === "brokerage");
  const plan529 = buckets.find((b) => b.bucketKey === "529");
  assert.ok(brokerage);
  assert.ok(plan529);

  const brVti = brokerage!.exposure.find((r) => r.underlyingSymbol === "VTI");
  const planVti = plan529!.exposure.find((r) => r.underlyingSymbol === "VTI");
  assert.ok(brVti);
  assert.ok(planVti);

  assert.equal(brVti!.spotMarketValue, 10 * livePx);
  assert.equal(planVti!.spotMarketValue, 20000);
});

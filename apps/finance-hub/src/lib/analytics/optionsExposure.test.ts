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

describe("getUnderlyingExposureByBucket plan fund re-marking", () => {
  it("re-marks brokerage spot MV with live price when the same symbol is a 529 plan fund", () => {
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
      `INSERT INTO accounts (id, connection_id, name, account_bucket, type) VALUES ('manual_529', 'conn_manual', '529', '529', 'brokerage')`,
    ).run();

    db.prepare(`INSERT INTO holding_snapshots (id, account_id, as_of) VALUES ('s_broker', 'schwab_tax', '2026-05-29')`).run();
    db.prepare(`INSERT INTO holding_snapshots (id, account_id, as_of) VALUES ('s_529', 'manual_529', '2026-05-29')`).run();

    db.prepare(
      `INSERT INTO securities (id, symbol, name, security_type) VALUES ('sec_vti', 'VTI', 'VTI', 'equity')`,
    ).run();
    db.prepare(
      `INSERT INTO securities (id, symbol, name, security_type) VALUES ('sec_fund', 'FXAIX', 'FXAIX', 'fund')`,
    ).run();

    // Brokerage: 10 shares, stale stored MV $200 (live mark is $250).
    db.prepare(
      `INSERT INTO positions (id, snapshot_id, security_id, quantity, price, market_value) VALUES ('p_broker', 's_broker', 'sec_vti', 10, 20, 200)`,
    ).run();
    // 529 plan fund: synthetic qty; statement-anchored MV must stay $50k.
    db.prepare(
      `INSERT INTO positions (id, snapshot_id, security_id, quantity, price, market_value, metadata_json)
       VALUES ('p_529', 's_529', 'sec_fund', 100, 500, 50000, '{"source":"manual","fundBasis":{"statementMarketValue":50000,"statementDate":"2026-05-01","basisTickerNav":350}}')`,
    ).run();

    const liveMarks = new Map([
      ["VTI", 25],
      ["FXAIX", 400],
    ]);
    const buckets = getUnderlyingExposureByBucket("real", liveMarks, db);

    const brokerage = buckets.find((b) => b.bucketKey === "brokerage");
    const plan529 = buckets.find((b) => b.bucketKey === "529");
    assert.ok(brokerage);
    assert.ok(plan529);

    const brokerVti = brokerage!.exposure.find((r) => r.underlyingSymbol === "VTI");
    const planFxaix = plan529!.exposure.find((r) => r.underlyingSymbol === "FXAIX");
    assert.ok(brokerVti);
    assert.ok(planFxaix);

    assert.equal(brokerVti!.spotMarketValue, 250);
    assert.equal(planFxaix!.spotMarketValue, 50_000);
  });
});

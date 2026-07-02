import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
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

function seedSharedVtiExposure(db: Database.Database): void {
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

  db.prepare(`INSERT INTO securities (id, symbol, name, security_type) VALUES ('sec_vti_eq', 'VTI', 'VTI', 'equity')`).run();
  db.prepare(`INSERT INTO securities (id, symbol, name, security_type) VALUES ('sec_vti_fund', 'VTI', 'VTI', 'fund')`).run();
  db.prepare(
    `INSERT INTO securities (id, symbol, name, security_type, underlying_security_id, option_type, expiration_date, strike_price)
     VALUES ('sec_vti_call', 'VTI  260117C00250000', 'VTI Call', 'option', 'sec_vti_eq', 'call', '2026-01-17', 250)`,
  ).run();

  db.prepare(
    `INSERT INTO positions (id, snapshot_id, security_id, quantity, price, market_value)
     VALUES ('pos_broker_vti', 'snap_broker', 'sec_vti_eq', 100, 100, 10000)`,
  ).run();
  db.prepare(
    `INSERT INTO positions (id, snapshot_id, security_id, quantity, price, market_value)
     VALUES ('pos_529_vti', 'snap_529', 'sec_vti_fund', 1, 250000, 250000)`,
  ).run();
  db.prepare(
    `INSERT INTO positions (id, snapshot_id, security_id, quantity, price, market_value)
     VALUES ('pos_broker_call', 'snap_broker', 'sec_vti_call', 1, 5, 500)`,
  ).run();
  db.prepare(
    `INSERT INTO option_greeks (id, position_id, delta, updated_at) VALUES ('og1', 'pos_broker_call', 0.5, '2026-05-28')`,
  ).run();
}

function exposureFor(
  buckets: ReturnType<typeof getUnderlyingExposureByBucket>,
  bucketKey: "brokerage" | "retirement" | "529",
  symbol: string,
) {
  const bucket = buckets.find((b) => b.bucketKey === bucketKey);
  return bucket?.exposure.find((row) => row.underlyingSymbol === symbol) ?? null;
}

describe("getUnderlyingExposureByBucket", () => {
  it("re-marks brokerage spot when the same symbol is also a 529 plan fund", () => {
    const db = createTestDb();
    seedSharedVtiExposure(db);

    const livePx = 110;
    const buckets = getUnderlyingExposureByBucket("auto", new Map([["VTI", livePx]]), db);

    const brokerage = exposureFor(buckets, "brokerage", "VTI");
    const plan529 = exposureFor(buckets, "529", "VTI");

    assert.equal(brokerage?.spotMarketValue, 100 * livePx);
    assert.equal(plan529?.spotMarketValue, 250000);
  });

  it("still values brokerage option synthetics when the underlying is a 529 plan fund", () => {
    const db = createTestDb();
    seedSharedVtiExposure(db);

    const livePx = 110;
    const buckets = getUnderlyingExposureByBucket("auto", new Map([["VTI", livePx]]), db);

    const brokerage = exposureFor(buckets, "brokerage", "VTI");
    assert.equal(brokerage?.syntheticShares, 50);
    assert.equal(brokerage?.syntheticMarketValue, 50 * livePx);
  });
});

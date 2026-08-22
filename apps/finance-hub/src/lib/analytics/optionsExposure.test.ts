import fs from "node:fs";
import path from "node:path";

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";

import {
  getUnderlyingExposureByBucket,
  portfolioImpliedEquityPriceMap,
} from "@/lib/analytics/optionsExposure";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  const schemaPath = path.join(process.cwd(), "src", "db", "schema.sql");
  db.exec(fs.readFileSync(schemaPath, "utf-8"));
  return db;
}

function seedAccount(
  db: Database.Database,
  params: {
    accountId: string;
    connectionId: string;
    connectionType: string;
    bucket: string;
    snapshotId: string;
  },
) {
  db.prepare(
    `
    INSERT OR IGNORE INTO institution_connections (id, type, display_name, status)
    VALUES (@connectionId, @connectionType, @connectionId, 'active')
  `,
  ).run(params);
  db.prepare(
    `
    INSERT INTO accounts (id, connection_id, name, account_bucket, type)
    VALUES (@accountId, @connectionId, @accountId, @bucket, @connectionType)
  `,
  ).run(params);
  db.prepare(
    `INSERT INTO holding_snapshots (id, account_id, as_of) VALUES (@snapshotId, @accountId, '2026-06-01T12:00:00Z')`,
  ).run(params);
}

describe("optionsExposure", () => {
  it("preserves 529 plan fund spot MV without suppressing same-ticker brokerage option exposure", () => {
    const db = createTestDb();
    seedAccount(db, {
      accountId: "manual_529",
      connectionId: "conn_manual",
      connectionType: "manual",
      bucket: "529",
      snapshotId: "snap_529",
    });
    seedAccount(db, {
      accountId: "schwab_brokerage",
      connectionId: "conn_schwab",
      connectionType: "schwab",
      bucket: "brokerage",
      snapshotId: "snap_brokerage",
    });

    db.prepare(
      `INSERT INTO securities (id, symbol, name, security_type) VALUES ('sec_VTI', 'VTI', 'VTI', 'fund')`,
    ).run();
    db.prepare(
      `INSERT INTO securities (id, symbol, name, security_type, underlying_security_id) VALUES ('sec_VTI_CALL', 'VTI   260619C00250000', 'VTI Call', 'option', 'sec_VTI')`,
    ).run();
    db.prepare(
      `INSERT INTO positions (id, snapshot_id, security_id, quantity, price, market_value, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "pos_529",
      "snap_529",
      "sec_VTI",
      1000,
      50,
      50_000,
      JSON.stringify({
        source: "manual",
        purchaseDate: null,
        fundBasis: { statementMarketValue: 50_000, statementDate: "2026-05-01", basisTickerNav: 50 },
      }),
    );
    db.prepare(
      `INSERT INTO positions (id, snapshot_id, security_id, quantity, price, market_value, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run("pos_stock", "snap_brokerage", "sec_VTI", 10, 200, 2_000, null);
    db.prepare(
      `INSERT INTO positions (id, snapshot_id, security_id, quantity, price, market_value, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run("pos_call", "snap_brokerage", "sec_VTI_CALL", -1, 5, -500, null);
    db.prepare(`INSERT INTO option_greeks (id, position_id, delta) VALUES ('greek_call', 'pos_call', 0.5)`).run();

    assert.equal(portfolioImpliedEquityPriceMap(db, "auto").get("VTI"), 200);

    const buckets = getUnderlyingExposureByBucket("auto", new Map([["VTI", 250]]), db);
    const plan = buckets.find((b) => b.bucketKey === "529")?.exposure.find((r) => r.underlyingSymbol === "VTI");
    const brokerage = buckets.find((b) => b.bucketKey === "brokerage")?.exposure.find((r) => r.underlyingSymbol === "VTI");

    assert.equal(plan?.spotMarketValue, 50_000);
    assert.equal(plan?.syntheticMarketValue, 0);
    assert.equal(brokerage?.spotMarketValue, 2_500);
    assert.equal(brokerage?.syntheticShares, -50);
    assert.equal(brokerage?.syntheticMarketValue, -12_500);
  });
});

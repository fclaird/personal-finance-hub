import fs from "node:fs";
import path from "node:path";

import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";

import { getUnderlyingExposureByBucketForDb } from "./optionsExposure";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  const schemaPath = path.join(process.cwd(), "src", "db", "schema.sql");
  db.exec(fs.readFileSync(schemaPath, "utf-8"));
  return db;
}

function rowForBucket(dbRows: ReturnType<typeof getUnderlyingExposureByBucketForDb>, bucketKey: string, symbol: string) {
  return dbRows.find((b) => b.bucketKey === bucketKey)?.exposure.find((r) => r.underlyingSymbol === symbol);
}

test("529 plan fund spot MV does not suppress same-ticker brokerage shares or option exposure", () => {
  const db = createTestDb();
  db.prepare(
    `INSERT INTO institution_connections (id, type, display_name, status) VALUES ('c_schwab', 'schwab', 'S', 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO institution_connections (id, type, display_name, status) VALUES ('conn_manual', 'manual', 'M', 'active')`,
  ).run();

  for (const [id, conn, bucket, snap] of [
    ["schwab_tax", "c_schwab", "brokerage", "snap_tax"],
    ["schwab_ira", "c_schwab", "retirement", "snap_ira"],
    ["manual_529", "conn_manual", "529", "snap_529"],
  ] as const) {
    db.prepare(
      `INSERT INTO accounts (id, connection_id, name, account_bucket, type) VALUES (?, ?, ?, ?, 'brokerage')`,
    ).run(id, conn, id, bucket);
    db.prepare(`INSERT INTO holding_snapshots (id, account_id, as_of) VALUES (?, ?, '2026-06-01')`).run(snap, id);
  }

  db.prepare(
    `INSERT INTO securities (id, symbol, name, security_type) VALUES ('sec_vti', 'VTI', 'VTI', 'equity')`,
  ).run();
  db.prepare(
    `INSERT INTO securities (id, symbol, name, security_type) VALUES ('sec_vti_529', 'VTI', 'VTI 529 proxy', 'fund')`,
  ).run();
  db.prepare(
    `
    INSERT INTO securities (id, symbol, name, security_type, underlying_security_id, option_type)
    VALUES ('sec_vti_call', 'VTI 260117C00200000', 'VTI call', 'option', 'sec_vti', 'CALL')
  `,
  ).run();

  db.prepare(
    `INSERT INTO positions (id, snapshot_id, security_id, quantity, price, market_value) VALUES ('pos_tax', 'snap_tax', 'sec_vti', 10, 100, 1000)`,
  ).run();
  db.prepare(
    `INSERT INTO positions (id, snapshot_id, security_id, quantity, price, market_value, metadata_json) VALUES ('pos_529', 'snap_529', 'sec_vti_529', 1000, 100, 50000, ?)`,
  ).run(JSON.stringify({ source: "manual", fundBasis: { statementMarketValue: 50000, statementDate: "2026-05-01", basisTickerNav: 100 } }));
  db.prepare(
    `INSERT INTO positions (id, snapshot_id, security_id, quantity, price, market_value) VALUES ('pos_call', 'snap_ira', 'sec_vti_call', 1, -1, -100)`,
  ).run();
  db.prepare(`INSERT INTO option_greeks (id, position_id, delta) VALUES ('greeks_call', 'pos_call', 0.5)`).run();

  const rows = getUnderlyingExposureByBucketForDb(db, "auto", new Map([["VTI", 200]]));

  assert.equal(rowForBucket(rows, "brokerage", "VTI")?.spotMarketValue, 2000);
  assert.equal(rowForBucket(rows, "retirement", "VTI")?.syntheticMarketValue, 10_000);
  assert.equal(rowForBucket(rows, "529", "VTI")?.spotMarketValue, 50_000);
});

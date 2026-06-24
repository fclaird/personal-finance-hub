import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import assert from "node:assert/strict";
import test from "node:test";

test("529 plan fund preservation does not suppress same-ticker brokerage or option exposure", async () => {
  const priorHome = process.env.HOME;
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "finance-hub-exposure-"));
  process.env.HOME = tempHome;
  try {
    const { getDb } = await import("@/lib/db");
    const { getUnderlyingExposureByBucket } = await import("@/lib/analytics/optionsExposure");
    const db = getDb();

    db.prepare(
      `INSERT INTO institution_connections (id, type, display_name, status) VALUES ('conn_schwab', 'schwab', 'Schwab', 'active')`,
    ).run();
    db.prepare(
      `INSERT INTO institution_connections (id, type, display_name, status) VALUES ('conn_manual', 'manual', 'Manual', 'active')`,
    ).run();
    db.prepare(
      `INSERT INTO accounts (id, connection_id, name, account_bucket, type) VALUES ('schwab_tax', 'conn_schwab', 'Taxable', 'brokerage', 'brokerage')`,
    ).run();
    db.prepare(
      `INSERT INTO accounts (id, connection_id, name, account_bucket, type) VALUES ('manual_529', 'conn_manual', 'College 529', '529', 'manual')`,
    ).run();
    db.prepare(`INSERT INTO holding_snapshots (id, account_id, as_of) VALUES ('snap_tax', 'schwab_tax', '2026-06-01')`).run();
    db.prepare(`INSERT INTO holding_snapshots (id, account_id, as_of) VALUES ('snap_529', 'manual_529', '2026-06-01')`).run();
    db.prepare(`INSERT INTO securities (id, symbol, name, security_type) VALUES ('sec_vti', 'VTI', 'VTI', 'equity')`).run();
    db.prepare(
      `INSERT INTO securities (id, symbol, name, security_type, underlying_security_id) VALUES ('sec_vti_call', 'VTI 260619C00250000', 'VTI 2026-06-19 C 250', 'option', 'sec_vti')`,
    ).run();
    db.prepare(
      `INSERT INTO positions (id, snapshot_id, security_id, quantity, price, market_value) VALUES ('pos_tax_vti', 'snap_tax', 'sec_vti', 10, 100, 1000)`,
    ).run();
    db.prepare(
      `INSERT INTO positions (id, snapshot_id, security_id, quantity, price, market_value, metadata_json) VALUES ('pos_529_vti', 'snap_529', 'sec_vti', 1000, 5, 5000, '{"source":"manual","purchaseDate":null}')`,
    ).run();
    db.prepare(
      `INSERT INTO positions (id, snapshot_id, security_id, quantity, price, market_value) VALUES ('pos_tax_call', 'snap_tax', 'sec_vti_call', -1, 1, -100)`,
    ).run();
    db.prepare(
      `INSERT INTO option_greeks (id, position_id, delta) VALUES ('greek_tax_call', 'pos_tax_call', 0.5)`,
    ).run();

    const buckets = getUnderlyingExposureByBucket("auto", new Map([["VTI", 120]]));
    const brokerage = buckets.find((bucket) => bucket.bucketKey === "brokerage")?.exposure.find((row) => row.underlyingSymbol === "VTI");
    const plan529 = buckets.find((bucket) => bucket.bucketKey === "529")?.exposure.find((row) => row.underlyingSymbol === "VTI");

    assert.ok(brokerage);
    assert.equal(brokerage.spotMarketValue, 1200);
    assert.equal(brokerage.syntheticShares, -50);
    assert.equal(brokerage.syntheticMarketValue, -6000);
    assert.ok(plan529);
    assert.equal(plan529.spotMarketValue, 5000);
    assert.equal(plan529.syntheticMarketValue, 0);
  } finally {
    process.env.HOME = priorHome;
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("529 plan-fund mark protection is scoped by bucket and preserves option synthetic exposure", async () => {
  const previousHome = process.env.HOME;
  process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), "finance-hub-options-exposure-"));

  const [{ getDb }, { getUnderlyingExposureByBucket }] = await Promise.all([
    import("@/lib/db"),
    import("@/lib/analytics/optionsExposure"),
  ]);
  const db = getDb();

  try {
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
    db.prepare(`INSERT INTO holding_snapshots (id, account_id, as_of) VALUES ('snap_tax', 'schwab_tax', '2026-05-28')`).run();
    db.prepare(`INSERT INTO holding_snapshots (id, account_id, as_of) VALUES ('snap_529', 'manual_529', '2026-05-28')`).run();

    db.prepare(`INSERT INTO securities (id, symbol, name, security_type) VALUES ('sec_vti_tax', 'VTI', 'VTI', 'equity')`).run();
    db.prepare(`INSERT INTO securities (id, symbol, name, security_type) VALUES ('sec_vti_529', 'VTI', 'VTI 529', 'fund')`).run();
    db.prepare(
      `INSERT INTO securities (id, symbol, name, security_type, underlying_security_id) VALUES ('sec_vti_call', 'VTI   260619C00100000', 'VTI Call', 'option', 'sec_vti_tax')`,
    ).run();

    db.prepare(
      `INSERT INTO positions (id, snapshot_id, security_id, quantity, price, market_value) VALUES ('p_tax_vti', 'snap_tax', 'sec_vti_tax', 10, 100, 1000)`,
    ).run();
    db.prepare(
      `INSERT INTO positions (id, snapshot_id, security_id, quantity, price, market_value) VALUES ('p_tax_call', 'snap_tax', 'sec_vti_call', 1, 5, 500)`,
    ).run();
    db.prepare(
      `INSERT INTO option_greeks (id, position_id, delta) VALUES ('g_tax_call', 'p_tax_call', 0.5)`,
    ).run();
    db.prepare(
      `INSERT INTO positions (id, snapshot_id, security_id, quantity, price, market_value, metadata_json) VALUES ('p_529_vti', 'snap_529', 'sec_vti_529', 1000, 50, 50000, '{"source":"manual"}')`,
    ).run();

    const buckets = getUnderlyingExposureByBucket("auto", new Map([["VTI", 200]]));
    const brokerageVti = buckets
      .find((bucket) => bucket.bucketKey === "brokerage")
      ?.exposure.find((row) => row.underlyingSymbol === "VTI");
    const planVti = buckets
      .find((bucket) => bucket.bucketKey === "529")
      ?.exposure.find((row) => row.underlyingSymbol === "VTI");

    assert.equal(brokerageVti?.spotMarketValue, 2000);
    assert.equal(brokerageVti?.syntheticMarketValue, 10000);
    assert.equal(planVti?.spotMarketValue, 50000);
    assert.equal(planVti?.syntheticMarketValue, 0);
  } finally {
    process.env.HOME = previousHome;
  }
});

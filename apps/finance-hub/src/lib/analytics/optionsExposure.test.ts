import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import assert from "node:assert/strict";
import test from "node:test";

test("529 fund rows do not suppress same-ticker brokerage shares or option exposure", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "finance-hub-exposure-"));
  const priorHome = process.env.HOME;
  process.env.HOME = home;

  try {
    const [{ getDb }, { getUnderlyingExposureByBucket }] = await Promise.all([
      import("@/lib/db"),
      import("./optionsExposure"),
    ]);
    const db = getDb();

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
    db.prepare(`INSERT INTO holding_snapshots (id, account_id, as_of) VALUES ('snap_tax', 'schwab_tax', '2026-06-01')`).run();
    db.prepare(`INSERT INTO holding_snapshots (id, account_id, as_of) VALUES ('snap_529', 'manual_529', '2026-06-01')`).run();
    db.prepare(`INSERT INTO securities (id, symbol, name, security_type) VALUES ('sec_VTI', 'VTI', 'VTI', 'equity')`).run();
    db.prepare(
      `INSERT INTO securities (id, symbol, name, security_type, underlying_security_id) VALUES ('sec_VTI_OPT', 'VTI   260619C00300000', 'VTI 2026-06-19 C 300', 'option', 'sec_VTI')`,
    ).run();
    db.prepare(
      `INSERT INTO positions (id, snapshot_id, security_id, quantity, price, market_value) VALUES ('p_tax_vti', 'snap_tax', 'sec_VTI', 10, 100, 1000)`,
    ).run();
    db.prepare(
      `INSERT INTO positions (id, snapshot_id, security_id, quantity, price, market_value, metadata_json) VALUES ('p_529_vti', 'snap_529', 'sec_VTI', 5, 100, 500, '{"source":"manual"}')`,
    ).run();
    db.prepare(
      `INSERT INTO positions (id, snapshot_id, security_id, quantity, price, market_value) VALUES ('p_tax_call', 'snap_tax', 'sec_VTI_OPT', 2, 1, 200)`,
    ).run();
    db.prepare(`INSERT INTO option_greeks (id, position_id, delta) VALUES ('g_tax_call', 'p_tax_call', 0.5)`).run();

    const buckets = getUnderlyingExposureByBucket("auto", new Map([["VTI", 300]]));
    const brokerage = buckets.find((b) => b.bucketKey === "brokerage")?.exposure.find((r) => r.underlyingSymbol === "VTI");
    const plan = buckets.find((b) => b.bucketKey === "529")?.exposure.find((r) => r.underlyingSymbol === "VTI");

    assert.ok(brokerage);
    assert.equal(brokerage.spotMarketValue, 10 * 300);
    assert.equal(brokerage.syntheticShares, 2 * 100 * 0.5);
    assert.equal(brokerage.syntheticMarketValue, 2 * 100 * 0.5 * 300);
    assert.ok(plan);
    assert.equal(plan.spotMarketValue, 500);

    db.close();
  } finally {
    if (priorHome === undefined) delete process.env.HOME;
    else process.env.HOME = priorHome;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

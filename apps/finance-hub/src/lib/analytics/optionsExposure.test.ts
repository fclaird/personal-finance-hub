import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("options exposure", () => {
  it("preserves 529 fund MV without suppressing same-ticker brokerage option exposure", async () => {
    const prevHome = process.env.HOME;
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "finance-hub-options-exposure-"));
    process.env.HOME = tempHome;

    try {
      const { getDb } = await import("@/lib/db");
      const { getUnderlyingExposureByBucket } = await import("./optionsExposure");
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
        `INSERT INTO accounts (id, connection_id, name, account_bucket, type) VALUES ('manual_529', 'conn_manual', '529 Plan', '529', 'manual')`,
      ).run();
      db.prepare(`INSERT INTO holding_snapshots (id, account_id, as_of) VALUES ('snap_tax', 'schwab_tax', '2026-06-01')`).run();
      db.prepare(`INSERT INTO holding_snapshots (id, account_id, as_of) VALUES ('snap_529', 'manual_529', '2026-06-01')`).run();
      db.prepare(`INSERT INTO securities (id, symbol, name, security_type) VALUES ('sec_VTI', 'VTI', 'VTI', 'fund')`).run();
      db.prepare(
        `INSERT INTO securities (id, symbol, name, security_type, underlying_security_id) VALUES ('sec_VTI_CALL', 'VTI   260619C00200000', 'VTI 2026-06-19 C 200', 'option', 'sec_VTI')`,
      ).run();

      db.prepare(
        `INSERT INTO positions (id, snapshot_id, security_id, quantity, price, market_value, metadata_json) VALUES ('pos_529', 'snap_529', 'sec_VTI', 10, 100, 1000, '{"source":"manual"}')`,
      ).run();
      db.prepare(
        `INSERT INTO positions (id, snapshot_id, security_id, quantity, price, market_value) VALUES ('pos_vti', 'snap_tax', 'sec_VTI', 5, 180, 900)`,
      ).run();
      db.prepare(
        `INSERT INTO positions (id, snapshot_id, security_id, quantity, price, market_value) VALUES ('pos_call', 'snap_tax', 'sec_VTI_CALL', 1, 3, 300)`,
      ).run();
      db.prepare(`INSERT INTO option_greeks (id, position_id, delta) VALUES ('greek_call', 'pos_call', 0.5)`).run();

      const buckets = getUnderlyingExposureByBucket("auto", new Map([["VTI", 200]]));
      const brokerage = buckets.find((b) => b.bucketKey === "brokerage")?.exposure.find((r) => r.underlyingSymbol === "VTI");
      const plan = buckets.find((b) => b.bucketKey === "529")?.exposure.find((r) => r.underlyingSymbol === "VTI");

      assert.ok(brokerage);
      assert.equal(brokerage.spotMarketValue, 1000);
      assert.equal(brokerage.syntheticShares, 50);
      assert.equal(brokerage.syntheticMarketValue, 10_000);
      assert.ok(plan);
      assert.equal(plan.spotMarketValue, 1000);
      assert.equal(plan.syntheticMarketValue, 0);
    } finally {
      if (prevHome === undefined) delete process.env.HOME;
      else process.env.HOME = prevHome;
    }
  });
});

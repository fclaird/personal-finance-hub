import assert from "node:assert/strict";
import { describe, it } from "node:test";

import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import { evaluateOptionRiskFlags, loadOptionRiskSummary, optionRiskEventsFromSummary } from "@/lib/alerts/optionRisk";
import type { OptionRiskPosition, OptionRiskSummary } from "@/lib/alerts/optionRisk";

const base = {
  quantity: -1,
  right: "C" as const,
  strike: 200,
  dte: 45,
  delta: -0.15,
  spot: 180,
  coveringShares: 0,
  pairedOppositeShort: false,
};

describe("evaluateOptionRiskFlags", () => {
  it("flags a naked short call as unbounded undefined risk", () => {
    const f = evaluateOptionRiskFlags(base);
    assert.equal(f.undefinedRisk, true);
    assert.equal(f.nakedShort, true);
    assert.equal(f.structure, "naked-call");
    assert.equal(f.maxLoss, "unbounded");
    assert.equal(f.deltaOffBand, false);
  });

  it("does not flag a covered call as undefined risk", () => {
    const f = evaluateOptionRiskFlags({ ...base, coveringShares: 100 });
    assert.equal(f.undefinedRisk, false);
    assert.equal(f.nakedShort, false);
    assert.equal(f.structure, "covered-call");
    assert.equal(f.maxLoss, "defined");
  });

  it("flags a naked short put (defined max loss) and a strangle as undefined", () => {
    const put = evaluateOptionRiskFlags({ ...base, right: "P", strike: 150, spot: 180, delta: 0.14 });
    assert.equal(put.nakedShort, true);
    assert.equal(put.undefinedRisk, false);
    assert.equal(put.maxLoss, "defined");
    const strangle = evaluateOptionRiskFlags({ ...base, pairedOppositeShort: true });
    assert.equal(strangle.structure, "short-strangle");
    assert.equal(strangle.undefinedRisk, true);
    assert.equal(strangle.maxLoss, "unbounded");
  });

  it("alerts when |Δ| leaves the ~0.15 band, DTE is short, or assignment is near", () => {
    const delta = evaluateOptionRiskFlags({ ...base, delta: -0.32 });
    assert.equal(delta.deltaOffBand, true);
    const dte = evaluateOptionRiskFlags({ ...base, dte: 5 });
    assert.equal(dte.shortDte, true);
    const assign = evaluateOptionRiskFlags({ ...base, spot: 201 });
    assert.equal(assign.itm, true);
    assert.equal(assign.assignmentNear, true);
  });
});

describe("optionRiskEventsFromSummary", () => {
  it("emits only enabled rule types", () => {
    const pos: OptionRiskPosition = {
      positionId: "p1",
      accountId: "a1",
      accountName: "Brokerage",
      symbol: "AAPL",
      underlying: "AAPL",
      quantity: -1,
      right: "C",
      strike: 200,
      expiration: "2026-07-17",
      dte: 5,
      delta: -0.32,
      spot: 201,
      intrinsic: 100,
      marginSecured: 20000,
      avgPrice: null,
      markPrice: null,
      iv: null,
      flags: evaluateOptionRiskFlags({ ...base, dte: 5, delta: -0.32, spot: 201 }),
    };
    const summary: OptionRiskSummary = {
      positions: [pos],
      undefinedRiskCount: 1,
      nakedShortCount: 1,
      marginPressure: [],
    };
    const all = optionRiskEventsFromSummary(
      summary,
      new Set(["undefined-risk", "naked-short", "delta-band", "option-dte", "assignment"]),
    );
    assert.ok(all.some((e) => e.ruleType === "undefined-risk"));
    assert.ok(all.some((e) => e.ruleType === "delta-band"));
    const onlyDrift = optionRiskEventsFromSummary(summary, new Set());
    assert.equal(onlyDrift.length, 0);
  });
});

function createRiskTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  const schemaPath = path.join(process.cwd(), "src", "db", "schema.sql");
  db.exec(fs.readFileSync(schemaPath, "utf-8"));
  return db;
}

describe("loadOptionRiskSummary OHLCV spot fallback", () => {
  it("fills spot from latest ohlcv 5m when equity MV and price_points are absent", () => {
    const db = createRiskTestDb();
    db.prepare(
      `INSERT OR IGNORE INTO institution_connections (id, type, display_name, status) VALUES ('conn1', 'schwab', 'Test', 'active')`,
    ).run();
    db.prepare(
      `INSERT INTO accounts (id, connection_id, name, nickname, account_bucket, type) VALUES ('schwab_a', 'conn1', 'Brokerage', NULL, 'brokerage', 'brokerage')`,
    ).run();
    db.prepare(`INSERT INTO holding_snapshots (id, account_id, as_of) VALUES ('snap1', 'schwab_a', '2026-09-04T20:00:00Z')`).run();
    db.prepare(
      `INSERT INTO securities (id, symbol, security_type, underlying_security_id) VALUES
        ('u_be', 'BE', 'equity', NULL),
        ('o_p', 'BE   260911P00235000', 'option', 'u_be'),
        ('o_c', 'BE   260911C00245000', 'option', 'u_be')`,
    ).run();
    // Options only — no equity row, no price_points for today
    db.prepare(
      `INSERT INTO positions (id, snapshot_id, security_id, quantity, price, market_value) VALUES
        ('p1', 'snap1', 'o_p', -1, 4.0, -400),
        ('p2', 'snap1', 'o_c', -1, 3.0, -300)`,
    ).run();
    db.prepare(
      `INSERT INTO ohlcv_points (provider, symbol, interval, ts_ms, close) VALUES
        ('schwab', 'BE', '1d', 1787202000000, 202.48),
        ('schwab', 'BE', '5m', 1788566100000, 266.18)`,
    ).run();

    const summary = loadOptionRiskSummary(db, { scope: "all_synced", flavor: "main" });
    assert.equal(summary.positions.length, 2);
    for (const p of summary.positions) {
      assert.equal(p.underlying, "BE");
      assert.equal(p.spot, 266.18);
    }
    db.close();
  });
});

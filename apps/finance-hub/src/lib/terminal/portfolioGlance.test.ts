import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it, test } from "node:test";
import Database from "better-sqlite3";

import { latestSnapshotIds } from "@/lib/holdings/latestSnapshots";
import {
  hasMaterialPortfolioExtendedMove,
  optionCloseValue,
  optionLastValue,
  optionValueAt,
  type OptionLeg,
  PORTFOLIO_INDEX_BASE,
  buildPortfolioIndexSeries,
} from "@/lib/terminal/portfolioGlance";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  const schemaPath = path.join(process.cwd(), "src", "db", "schema.sql");
  db.exec(fs.readFileSync(schemaPath, "utf-8"));
  return db;
}

function loadPositionRows(db: Database.Database, snapshotIds: string[]) {
  return db
    .prepare(
      `
      SELECT
        s.security_type AS security_type,
        s.symbol AS symbol,
        SUM(p.quantity) AS quantity,
        SUM(COALESCE(p.market_value, 0)) AS market_value
      FROM positions p
      JOIN securities s ON s.id = p.security_id
      WHERE p.snapshot_id IN (SELECT value FROM json_each(@snaps))
      GROUP BY s.id, s.security_type, s.symbol
    `,
    )
    .all({ snaps: JSON.stringify(snapshotIds) }) as Array<{
    security_type: string;
    symbol: string | null;
    quantity: number;
    market_value: number;
  }>;
}

describe("portfolioGlance snapshot selection", () => {
  it("prefers all_synced snapshots and aggregates cash with equities", () => {
    const db = createTestDb();
    db.prepare(
      `INSERT INTO institution_connections (id, type, display_name, status) VALUES ('c1', 'schwab', 'S', 'active')`,
    ).run();
    db.prepare(
      `INSERT INTO accounts (id, connection_id, name, account_bucket, type) VALUES ('schwab_a', 'c1', 'Taxable', 'brokerage', 'brokerage')`,
    ).run();
    db.prepare(`INSERT INTO holding_snapshots (id, account_id, as_of) VALUES ('snap1', 'schwab_a', '2025-06-01')`).run();
    db.prepare(`INSERT INTO securities (id, symbol, name, security_type) VALUES ('sec_cash', 'CASH', 'Cash', 'cash')`).run();
    db.prepare(`INSERT INTO securities (id, symbol, name, security_type) VALUES ('sec_vti', 'VTI', 'VTI', 'equity')`).run();
    db.prepare(
      `INSERT INTO positions (id, snapshot_id, security_id, quantity, price, market_value) VALUES ('p_cash', 'snap1', 'sec_cash', 1, 500, 500)`,
    ).run();
    db.prepare(
      `INSERT INTO positions (id, snapshot_id, security_id, quantity, price, market_value) VALUES ('p_vti', 'snap1', 'sec_vti', 10, 100, 1000)`,
    ).run();

    const snapshotIds = latestSnapshotIds(db, "all_synced");
    assert.deepEqual(snapshotIds, ["snap1"]);

    const rows = loadPositionRows(db, snapshotIds);
    const cashMv = rows.find((r) => r.security_type === "cash")?.market_value ?? 0;
    const equityMv = rows.find((r) => r.symbol === "VTI")?.market_value ?? 0;
    assert.equal(cashMv, 500);
    assert.equal(equityMv, 1000);
    assert.equal(cashMv + equityMv, 1500);
  });

  it("returns empty snapshot list when no accounts exist", () => {
    const db = createTestDb();
    assert.deepEqual(latestSnapshotIds(db, "all_synced"), []);
  });
});

function sampleOption(overrides: Partial<OptionLeg> = {}): OptionLeg {
  return {
    quantity: 1,
    closePerShare: 2,
    lastPerShare: 2.5,
    thetaPerShare: -0.05,
    syncedMv: 200,
    ...overrides,
  };
}

test("optionValueAt interpolates from close to live mark during RTH", () => {
  const leg = sampleOption();
  const open = new Date("2026-05-22T09:30:00-04:00").getTime();
  const close = new Date("2026-05-22T16:00:00-04:00").getTime();
  const mid = new Date("2026-05-22T12:45:00-04:00").getTime();

  assert.equal(optionValueAt(leg, open, close, open), optionCloseValue(leg));
  assert.equal(optionValueAt(leg, close, close, open), optionLastValue(leg));

  const midValue = optionValueAt(leg, mid, close, open);
  assert.ok(midValue > optionCloseValue(leg));
  assert.ok(midValue < optionLastValue(leg));
});

test("optionValueAt prefers live mark after RTH", () => {
  const leg = sampleOption({ thetaPerShare: 5 });
  const close = new Date("2026-05-22T16:00:00-04:00").getTime();
  const after = new Date("2026-05-22T18:00:00-04:00").getTime();
  const open = new Date("2026-05-22T09:30:00-04:00").getTime();

  assert.equal(optionValueAt(leg, after, close, open), optionLastValue(leg));
});

test("portfolio index base is 100", () => {
  assert.equal(PORTFOLIO_INDEX_BASE, 100);
});

test("hasMaterialPortfolioExtendedMove rejects flat extended path", () => {
  assert.equal(hasMaterialPortfolioExtendedMove(101.86, 101.86), false);
  assert.equal(hasMaterialPortfolioExtendedMove(101.86, 101.861), false);
});

test("hasMaterialPortfolioExtendedMove accepts material extended move", () => {
  assert.equal(hasMaterialPortfolioExtendedMove(101.86, 101.9), true);
  assert.equal(hasMaterialPortfolioExtendedMove(100, 99.97), true);
});

test("buildPortfolioIndexSeries anchors at 100 when no intraday points exist", () => {
  const nowMs = Date.parse("2026-05-22T17:00:00.000Z");
  const series = buildPortfolioIndexSeries([], 1_000_000, 1_001_100, "2026-05-22", nowMs);
  assert.equal(series.length, 2);
  assert.equal(series[0]!.close, 100);
  assert.ok(Math.abs(series[1]!.close - 100.11) < 1e-9);
});

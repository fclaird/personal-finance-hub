import fs from "node:fs";
import path from "node:path";

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";

import { hasCoveringShares, longShareQuantityForUnderlying } from "@/lib/strategy/equityCoverage";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  const schemaPath = path.join(process.cwd(), "src", "db", "schema.sql");
  db.exec(fs.readFileSync(schemaPath, "utf-8"));
  db.prepare(
    `INSERT INTO institution_connections (id, type, display_name, status) VALUES ('c1', 'schwab', 'Schwab', 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO accounts (id, connection_id, name, type, currency, updated_at)
     VALUES ('schwab_1', 'c1', 'Brokerage', 'MARGIN', 'USD', datetime('now'))`,
  ).run();
  db.prepare(`INSERT INTO securities (id, symbol, name, security_type) VALUES ('s1', 'AAPL', 'Apple', 'equity')`).run();
  return db;
}

describe("longShareQuantityForUnderlying as-of coverage", () => {
  it("does not treat shares bought after the trade date as covering a historical short call", () => {
    const db = createTestDb();
    db.prepare(`INSERT INTO holding_snapshots (id, account_id, as_of) VALUES ('hs_old', 'schwab_1', '2026-01-15T21:00:00Z')`).run();
    db.prepare(
      `INSERT INTO positions (id, snapshot_id, security_id, quantity, price, market_value) VALUES ('p_old', 'hs_old', 's1', 0, 180, 0)`,
    ).run();
    db.prepare(`INSERT INTO holding_snapshots (id, account_id, as_of) VALUES ('hs_now', 'schwab_1', '2026-09-01T20:00:00Z')`).run();
    db.prepare(
      `INSERT INTO positions (id, snapshot_id, security_id, quantity, price, market_value) VALUES ('p_now', 'hs_now', 's1', 100, 220, 22000)`,
    ).run();

    assert.equal(longShareQuantityForUnderlying(db, "schwab_1", "AAPL"), 100);
    assert.equal(longShareQuantityForUnderlying(db, "schwab_1", "AAPL", "2026-01-20"), 0);
    assert.equal(hasCoveringShares(db, "schwab_1", "AAPL", 1, "2026-01-20"), false);
    assert.equal(hasCoveringShares(db, "schwab_1", "AAPL", 1, "2026-09-01"), true);
  });

  it("uses trade history on or before asOf when older snapshots were pruned", () => {
    const db = createTestDb();
    db.prepare(`INSERT INTO holding_snapshots (id, account_id, as_of) VALUES ('hs_now', 'schwab_1', '2026-09-01T20:00:00Z')`).run();
    db.prepare(
      `INSERT INTO positions (id, snapshot_id, security_id, quantity, price, market_value) VALUES ('p_now', 'hs_now', 's1', 100, 220, 22000)`,
    ).run();
    db.prepare(
      `INSERT INTO broker_transactions (
        id, account_id, external_activity_id, trade_date, transaction_type, raw_json,
        symbol, asset_type, instruction, quantity, updated_at
      ) VALUES (
        'btx_buy', 'schwab_1', '1', '2026-08-15', 'TRADE', '{}',
        'AAPL', 'EQUITY', 'BUY', 100, datetime('now')
      )`,
    ).run();

    assert.equal(hasCoveringShares(db, "schwab_1", "AAPL", 1, "2026-01-20"), false);
    assert.equal(hasCoveringShares(db, "schwab_1", "AAPL", 1, "2026-08-15"), true);
  });
});

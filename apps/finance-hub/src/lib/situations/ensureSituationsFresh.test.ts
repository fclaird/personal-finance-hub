import fs from "node:fs";
import path from "node:path";

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";

import {
  __resetEnsureSituationsFreshMutexForTests,
  brokerOptionFillsFingerprint,
  ensureSituationsFresh,
  recordSituationsLinkFingerprint,
  situationsRebuildNeeded,
  SITUATIONS_FRESH_MAX_AGE_MS,
} from "@/lib/situations/ensureSituationsFresh";

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
  return db;
}

function occ(root: string, yymmdd: string, right: "C" | "P", strike: number): string {
  return `${root.padEnd(6, " ")}${yymmdd}${right}${Math.round(strike * 1000).toString().padStart(8, "0")}`;
}

function insertOptionTx(db: Database.Database, id: string, ext: string, date: string) {
  const symbol = occ("IWM", "260717", "P", 180);
  const raw = {
    activityId: Number(ext),
    tradeDate: date,
    type: "TRADE",
    netAmount: 200,
    transactionItem: [
      {
        instruction: "SELL_TO_OPEN",
        positionEffect: "OPENING",
        quantity: 1,
        instrument: { symbol, underlyingSymbol: "IWM", assetType: "OPTION" },
      },
    ],
  };
  db.prepare(
    `INSERT INTO broker_transactions (
      id, account_id, external_activity_id, trade_date, transaction_type, net_amount, raw_json,
      symbol, underlying_symbol, asset_type, instruction, position_effect, quantity,
      option_expiration, option_right, option_strike, updated_at
    ) VALUES (
      @id, 'schwab_1', @ext, @date, 'TRADE', 200, @raw,
      @symbol, 'IWM', 'OPTION', 'SELL_TO_OPEN', 'OPENING', 1,
      '2026-07-17', 'P', 180, datetime('now')
    )`,
  ).run({ id, ext, date, raw: JSON.stringify(raw), symbol });
}

describe("ensureSituationsFresh", () => {
  it("empty book → rebuild needed, then fingerprint unchanged skips", () => {
    __resetEnsureSituationsFreshMutexForTests();
    const db = createTestDb();
    insertOptionTx(db, "put", "1", "2026-06-01");
    insertOptionTx(db, "call", "2", "2026-06-01");

    const fp = brokerOptionFillsFingerprint(db);
    assert.match(fp, /^2\|/);
    assert.equal(situationsRebuildNeeded(db, fp).reason, "empty");

    const first = ensureSituationsFresh(db);
    assert.equal(first.rebuilt, true);
    assert.equal(first.reason, "empty");
    assert.ok((first.proposed ?? 0) >= 1);

    const second = ensureSituationsFresh(db);
    assert.equal(second.rebuilt, false);
    assert.equal(second.reason, "unchanged");
  });

  it("fingerprint change after new fill → rebuild", () => {
    __resetEnsureSituationsFreshMutexForTests();
    const db = createTestDb();
    insertOptionTx(db, "put", "1", "2026-06-01");
    const a = ensureSituationsFresh(db);
    assert.equal(a.rebuilt, true);

    insertOptionTx(db, "call", "2", "2026-06-01");
    const check = situationsRebuildNeeded(db, brokerOptionFillsFingerprint(db));
    assert.equal(check.needed, true);
    assert.equal(check.reason, "fingerprint");

    const b = ensureSituationsFresh(db);
    assert.equal(b.rebuilt, true);
    assert.equal(b.reason, "fingerprint");
  });

  it("stale rebuild older than 6h → rebuild needed", () => {
    __resetEnsureSituationsFreshMutexForTests();
    const db = createTestDb();
    insertOptionTx(db, "put", "1", "2026-06-01");
    ensureSituationsFresh(db);
    const fp = brokerOptionFillsFingerprint(db);
    // Backdate meta
    db.prepare(`UPDATE situation_link_meta SET value = ? WHERE key = 'rebuilt_at'`).run(
      new Date(Date.now() - SITUATIONS_FRESH_MAX_AGE_MS - 60_000).toISOString(),
    );
    const check = situationsRebuildNeeded(db, fp);
    assert.equal(check.needed, true);
    assert.equal(check.reason, "stale");
  });

  it("force always rebuilds and records fingerprint", () => {
    __resetEnsureSituationsFreshMutexForTests();
    const db = createTestDb();
    insertOptionTx(db, "put", "1", "2026-06-01");
    ensureSituationsFresh(db);
    const forced = ensureSituationsFresh(db, { force: true });
    assert.equal(forced.rebuilt, true);
    assert.equal(forced.reason, "forced");
    assert.equal(recordSituationsLinkFingerprint(db), brokerOptionFillsFingerprint(db));
  });
});

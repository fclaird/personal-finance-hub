import fs from "node:fs";
import path from "node:path";

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";

import { listSituations, rebuildAutoSituations, setSituationLinkStatus } from "@/lib/situations/persistSituations";

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

function insertTx(
  db: Database.Database,
  opts: {
    id: string;
    ext: string;
    date: string;
    net: number;
    instruction: string;
    symbol: string;
    underlying: string;
    right: "C" | "P";
    strike: number;
    exp: string;
    effect?: string;
  },
) {
  const raw = {
    activityId: Number(opts.ext),
    tradeDate: opts.date,
    type: "TRADE",
    netAmount: opts.net,
    transactionItem: [
      {
        instruction: opts.instruction,
        positionEffect: opts.effect ?? (opts.instruction.includes("OPEN") ? "OPENING" : "CLOSING"),
        quantity: 1,
        instrument: {
          symbol: opts.symbol,
          underlyingSymbol: opts.underlying,
          assetType: "OPTION",
        },
      },
    ],
  };
  db.prepare(
    `INSERT INTO broker_transactions (
      id, account_id, external_activity_id, trade_date, transaction_type, net_amount, raw_json,
      symbol, underlying_symbol, asset_type, instruction, position_effect, quantity,
      option_expiration, option_right, option_strike, updated_at
    ) VALUES (
      @id, 'schwab_1', @ext, @date, 'TRADE', @net, @raw,
      @symbol, @underlying, 'OPTION', @instruction, @effect, 1,
      @exp, @right, @strike, datetime('now')
    )`,
  ).run({
    id: opts.id,
    ext: opts.ext,
    date: opts.date,
    net: opts.net,
    raw: JSON.stringify(raw),
    symbol: opts.symbol,
    underlying: opts.underlying,
    instruction: opts.instruction,
    effect: opts.effect ?? (opts.instruction.includes("OPEN") ? "OPENING" : "CLOSING"),
    exp: opts.exp,
    right: opts.right,
    strike: opts.strike,
  });
}

describe("persistSituations", () => {
  it("proposes a same-day strangle, confirms it, and keeps it across rebuild", () => {
    const db = createTestDb();
    insertTx(db, {
      id: "put",
      ext: "1",
      date: "2026-06-01",
      net: 200,
      instruction: "SELL_TO_OPEN",
      symbol: occ("IWM", "260717", "P", 180),
      underlying: "IWM",
      right: "P",
      strike: 180,
      exp: "2026-07-17",
    });
    insertTx(db, {
      id: "call",
      ext: "2",
      date: "2026-06-01",
      net: 150,
      instruction: "SELL_TO_OPEN",
      symbol: occ("IWM", "260717", "C", 230),
      underlying: "IWM",
      right: "C",
      strike: 230,
      exp: "2026-07-17",
    });

    const first = rebuildAutoSituations(db);
    assert.equal(first.proposed, 1);
    const listed = listSituations(db);
    assert.equal(listed.length, 1);
    assert.equal(listed[0]!.kind, "short-strangle");
    assert.equal(listed[0]!.netPremium, 350);
    assert.equal(listed[0]!.linkStatus, "auto");

    assert.equal(setSituationLinkStatus(db, listed[0]!.id, "confirmed"), true);
    const second = rebuildAutoSituations(db);
    assert.equal(second.kept, 1);
    assert.equal(second.proposed, 0);
    const again = listSituations(db);
    assert.equal(again.length, 1);
    assert.equal(again[0]!.linkStatus, "confirmed");
  });
});

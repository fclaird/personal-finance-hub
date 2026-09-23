import fs from "node:fs";
import path from "node:path";

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";

import { SCHWAB_REFRESH_TRANSACTION_LOOKBACK_DAYS } from "./config";
import { fetchSchwabTransactionsChunked } from "./fetchAccountTransactions";
import { syncSchwabBrokerTransactions } from "./syncBrokerTransactions";
import type { SchwabTxnRaw } from "./transactionNormalize";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  const schemaPath = path.join(process.cwd(), "src", "db", "schema.sql");
  db.exec(fs.readFileSync(schemaPath, "utf-8"));
  return db;
}

function seedAccount(db: Database.Database, accountId: string) {
  db.prepare(
    `INSERT INTO institution_connections (id, type, display_name, status, created_at, updated_at)
     VALUES ('c1', 'schwab', 'Schwab', 'active', datetime('now'), datetime('now'))`,
  ).run();
  db.prepare(
    `INSERT INTO accounts (id, connection_id, name, type, currency, updated_at)
     VALUES (?, 'c1', 'Brokerage', 'MARGIN', 'USD', datetime('now'))`,
  ).run(accountId);
}

function trade(id: number, date: string): SchwabTxnRaw {
  return {
    activityId: id,
    tradeDate: date,
    type: "TRADE",
    netAmount: 10,
    description: `trade ${id}`,
    transactionItem: [
      {
        instruction: "BUY",
        positionEffect: "OPENING",
        quantity: 1,
        price: 10,
        instrument: { symbol: "AAPL", underlyingSymbol: "AAPL", assetType: "EQUITY" },
      },
    ],
  };
}

describe("syncSchwabBrokerTransactions", () => {
  it("persists a 14-day refresh from the single scheduler window", async () => {
    const db = createTestDb();
    seedAccount(db, "schwab_999");
    let fetches = 0;

    const result = await syncSchwabBrokerTransactions({
      db,
      lookbackDays: SCHWAB_REFRESH_TRANSACTION_LOOKBACK_DAYS,
      fetchAccountNumbers: async () => [{ accountNumber: "999", hashValue: "hash-1" }],
      fetchTransactionsChunked: (hash, days, onChunk) =>
        fetchSchwabTransactionsChunked(hash, days, onChunk, {
          endCapIso: "2020-06-15",
          fetchWindow: async () => {
            fetches += 1;
            return [trade(1, "2020-06-10"), trade(2, "2020-06-12")];
          },
        }),
    });

    assert.equal(fetches, 1);
    assert.deepEqual(result, {
      ok: true,
      lookbackDays: 14,
      accountsUpdated: 1,
      transactionsUpserted: 2,
      classified: 2,
    });
    const count = db.prepare(`SELECT COUNT(*) AS c FROM broker_transactions`).get() as { c: number };
    assert.equal(count.c, 2);
    const hash = db.prepare(`SELECT schwab_account_hash AS hash FROM accounts WHERE id = ?`).get("schwab_999") as {
      hash: string;
    };
    assert.equal(hash.hash, "hash-1");
  });

  it("upserts each streamed chunk and does not double-count overlap", async () => {
    const db = createTestDb();
    seedAccount(db, "schwab_999");
    const batchSizes: number[] = [];
    let fetches = 0;

    const result = await syncSchwabBrokerTransactions({
      db,
      lookbackDays: 25,
      fetchAccountNumbers: async () => [{ accountNumber: "999", hashValue: "hash-1" }],
      fetchTransactionsChunked: (hash, days, onChunk) =>
        fetchSchwabTransactionsChunked(
          hash,
          days,
          async (batch) => {
            batchSizes.push(batch.length);
            await onChunk(batch);
          },
          {
            endCapIso: "2020-06-15",
            chunkDays: 10,
            fetchWindow: async (_hash, _start, end) => {
              fetches += 1;
              if (fetches === 1) return [trade(10, end)];
              if (fetches === 2) return [trade(20, end), trade(10, end)];
              return [trade(20, end)];
            },
          },
        ),
    });

    assert.equal(fetches, 3);
    assert.deepEqual(batchSizes, [1, 1, 0]);
    assert.equal(result.transactionsUpserted, 2);
    assert.equal(result.classified, 2);
    assert.equal(result.ok, true);
    assert.equal("transactions" in result, false);

    const rows = db
      .prepare(`SELECT external_activity_id FROM broker_transactions ORDER BY external_activity_id`)
      .all() as { external_activity_id: string }[];
    assert.deepEqual(
      rows.map((r) => r.external_activity_id),
      ["10", "20"],
    );
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import Database from "better-sqlite3";

import { earningsForSymbols, exDividendsForSymbols, heldSymbols, openOptions } from "@/lib/events/queries";

function db(): Database.Database {
  const database = new Database(":memory:");
  database.exec(`
    CREATE TABLE securities (
      id TEXT PRIMARY KEY,
      symbol TEXT,
      security_type TEXT NOT NULL,
      underlying_security_id TEXT,
      expiration_date TEXT
    );
    CREATE TABLE positions (
      id TEXT PRIMARY KEY,
      snapshot_id TEXT NOT NULL,
      security_id TEXT NOT NULL,
      quantity REAL NOT NULL,
      price REAL,
      market_value REAL,
      metadata_json TEXT
    );
    CREATE TABLE earnings_events (
      id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      earnings_date TEXT NOT NULL,
      time_of_day TEXT,
      source TEXT NOT NULL
    );
    CREATE TABLE cashflows (
      id TEXT PRIMARY KEY,
      security_id TEXT,
      ex_date TEXT,
      type TEXT NOT NULL
    );
    CREATE TABLE dividend_model_symbol_fundamentals_snap (
      symbol TEXT,
      next_ex_date TEXT
    );
  `);
  return database;
}

describe("event calendar queries", () => {
  it("reads held names, open options, earnings, and ex-dividend dates for those names", () => {
    const database = db();
    database.prepare(`INSERT INTO securities (id, symbol, security_type, underlying_security_id, expiration_date) VALUES (?, ?, ?, ?, ?)`).run("eq", "NOW", "equity", null, null);
    database.prepare(`INSERT INTO securities (id, symbol, security_type, underlying_security_id, expiration_date) VALUES (?, ?, ?, ?, ?)`).run("opt", "NOW  261120C150", "option", "eq", "2026-11-20");
    database.prepare(`INSERT INTO securities (id, symbol, security_type, underlying_security_id, expiration_date) VALUES (?, ?, ?, ?, ?)`).run("cash", "CASH", "cash", null, null);
    database.prepare(`INSERT INTO positions (id, snapshot_id, security_id, quantity) VALUES (?, ?, ?, ?)`).run("p1", "snap", "eq", 10);
    database.prepare(`INSERT INTO positions (id, snapshot_id, security_id, quantity) VALUES (?, ?, ?, ?)`).run("p2", "snap", "opt", 1);
    database.prepare(`INSERT INTO positions (id, snapshot_id, security_id, quantity) VALUES (?, ?, ?, ?)`).run("p3", "snap", "cash", 1);
    database.prepare(`INSERT INTO earnings_events (id, symbol, earnings_date, time_of_day, source) VALUES (?, ?, ?, ?, ?)`).run("e1", "now", "2026-11-05", "amc", "finnhub");
    database.prepare(`INSERT INTO earnings_events (id, symbol, earnings_date, time_of_day, source) VALUES (?, ?, ?, ?, ?)`).run("e2", "MSFT", "2026-11-01", null, "finnhub");
    database.prepare(`INSERT INTO cashflows (id, security_id, ex_date, type) VALUES (?, ?, ?, ?)`).run("c1", "eq", "2026-11-07", "dividend_projected");
    database.prepare(`INSERT INTO dividend_model_symbol_fundamentals_snap (symbol, next_ex_date) VALUES (?, ?)`).run("AAPL", "2026-11-12");

    assert.deepEqual(heldSymbols(database, ["snap"]), ["NOW"]);
    const options = openOptions(database, ["snap"]);
    assert.equal(options.length, 1);
    assert.equal(options[0]?.underlying, "NOW");
    assert.equal(options[0]?.expiry, "2026-11-20");
    const earnings = earningsForSymbols(database, ["NOW", "AAPL"], "2026-10-11", "2026-12-31");
    assert.equal(earnings.length, 1);
    assert.equal(earnings[0]?.symbol, "NOW");
    const ex = exDividendsForSymbols(database, ["NOW", "AAPL"], "2026-10-11", "2026-12-31");
    assert.deepEqual(
      ex.map((row) => `${row.symbol}:${row.date}:${row.source}`),
      ["NOW:2026-11-07:cashflows", "AAPL:2026-11-12:dividend fundamentals"],
    );
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";

import { bookOverlayFromRows, loadBookOverlay } from "@/lib/charts/bookOverlay";
import { readStoredCandles, writeStoredCandles } from "@/lib/charts/candleStore";
import { readDrawingDocument, writeDrawingDocument } from "@/lib/charts/drawingStore";
import { candlesFromPayload, metaFromPayload, yahooChartUrl, type YahooOhlcvPayload } from "@/lib/charts/yahooOhlcv";

describe("yahoo candles", () => {
  it("keeps the New York session date and drops empty prints", () => {
    const payload: YahooOhlcvPayload = {
      meta: { longName: "Tesla, Inc.", fullExchangeName: "NasdaqGS", marketState: "POST", postMarketPrice: 381.2 },
      timestamp: [Date.UTC(2024, 0, 2, 14, 30) / 1000, Date.UTC(2024, 0, 3, 14, 30) / 1000],
      open: [10, null],
      high: [12, 1],
      low: [9, 1],
      close: [11, 1],
      volume: [100, 5],
    };
    const candles = candlesFromPayload(payload, "1d");
    assert.equal(candles.length, 1);
    assert.equal(candles[0]!.time, "2024-01-02");
    assert.equal(candles[0]!.close, 11);
    const meta = metaFromPayload(payload);
    assert.equal(meta.name, "Tesla, Inc.");
    assert.equal(meta.exchange, "NASDAQ");
    assert.equal(meta.postMarket?.price, 381.2);
  });

  it("asks Yahoo for ten years of daily bars so the history stays daily", () => {
    const url = yahooChartUrl("TSLA", "1d");
    assert.match(url, /interval=1d/);
    assert.match(url, /range=10y/);
  });
});

describe("candle cache", () => {
  it("round-trips a daily bar on the same session date", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE ohlcv_points (
        provider TEXT NOT NULL, symbol TEXT NOT NULL, interval TEXT NOT NULL, ts_ms INTEGER NOT NULL,
        open REAL, high REAL, low REAL, close REAL, volume REAL,
        PRIMARY KEY (provider, symbol, interval, ts_ms)
      );
      CREATE TABLE chart_candle_cache (
        provider TEXT NOT NULL, symbol TEXT NOT NULL, interval TEXT NOT NULL,
        fetched_at TEXT NOT NULL, meta_json TEXT,
        PRIMARY KEY (provider, symbol, interval)
      );
    `);
    writeStoredCandles(
      db,
      "TSLA",
      "1d",
      [{ time: "2024-01-02", open: 10, high: 12, low: 9, close: 11, volume: 100 }],
      {
        name: "Tesla, Inc.",
        exchange: "NASDAQ",
        currency: "USD",
        marketState: "CLOSED",
        previousClose: 10,
        postMarket: null,
        preMarket: null,
        timezone: "America/New_York",
      },
    );
    writeStoredCandles(
      db,
      "TSLA",
      "1d",
      [{ time: "2024-01-02", open: 10, high: 13, low: 9, close: 12.5, volume: 120 }],
      {
        name: "Tesla, Inc.",
        exchange: "NASDAQ",
        currency: "USD",
        marketState: "CLOSED",
        previousClose: 10,
        postMarket: null,
        preMarket: null,
        timezone: "America/New_York",
      },
    );
    const rows = readStoredCandles(db, "TSLA", "1d");
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.time, "2024-01-02");
    assert.equal(rows[0]!.close, 12.5);
  });
});

describe("drawing store", () => {
  it("saves and reloads a document", () => {
    const db = new Database(":memory:");
    db.exec(`CREATE TABLE chart_drawings (symbol TEXT PRIMARY KEY, document_json TEXT NOT NULL, updated_at TEXT NOT NULL)`);
    writeDrawingDocument(db, "TSLA", {
      version: 1,
      locked: false,
      hidden: false,
      drawings: [
        {
          id: "line-1",
          type: "hline",
          a: { time: "2024-01-02", price: 250 },
          color: "#F23645",
          width: 2,
          dash: "dashed",
        },
      ],
    });
    const loaded = readDrawingDocument(db, "TSLA");
    assert.equal(loaded.drawings.length, 1);
    assert.equal(loaded.drawings[0]!.type, "hline");
  });
});

describe("book overlay", () => {
  it("groups strikes and expiries for the underlying", () => {
    const overlay = bookOverlayFromRows("TSLA", [
      {
        symbol: "TSLA  260619C00260000",
        name: null,
        underlying: "TSLA",
        strike: 260,
        expiration: "2026-06-19",
        right: "C",
        quantity: -1,
      },
      {
        symbol: "TSLA  260619P00250000",
        name: null,
        underlying: null,
        strike: null,
        expiration: null,
        right: null,
        quantity: -2,
      },
    ]);
    assert.deepEqual(
      overlay.strikes.map((row) => row.strike),
      [250, 260],
    );
    assert.deepEqual(overlay.expiries, ["2026-06-19"]);
    assert.equal(overlay.strikes[0]!.rights[0], "P");
  });

  it("reads the latest snapshot for the flavor", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE accounts (id TEXT PRIMARY KEY, name TEXT);
      CREATE TABLE holding_snapshots (id TEXT PRIMARY KEY, account_id TEXT, as_of TEXT);
      CREATE TABLE securities (
        id TEXT PRIMARY KEY, symbol TEXT, name TEXT, security_type TEXT,
        underlying_security_id TEXT, option_type TEXT, expiration_date TEXT, strike_price REAL
      );
      CREATE TABLE positions (id TEXT PRIMARY KEY, snapshot_id TEXT, security_id TEXT, quantity REAL);
    `);
    db.prepare(`INSERT INTO accounts (id, name) VALUES ('schwab_charttest', 'Broker')`).run();
    db.prepare(`INSERT INTO holding_snapshots (id, account_id, as_of) VALUES ('old', 'schwab_charttest', '2026-01-01'), ('new', 'schwab_charttest', '2026-11-01')`).run();
    db.prepare(`INSERT INTO securities (id, symbol, name, security_type) VALUES ('eq', 'TSLA', 'Tesla', 'equity')`).run();
    db.prepare(
      `INSERT INTO securities (id, symbol, name, security_type, underlying_security_id, option_type, expiration_date, strike_price)
       VALUES ('opt', 'TSLA  261218C00400000', 'TSLA call', 'option', 'eq', 'C', '2026-12-18', 400)`,
    ).run();
    db.prepare(`INSERT INTO positions (id, snapshot_id, security_id, quantity) VALUES ('p1', 'old', 'opt', -9), ('p2', 'new', 'opt', -1)`).run();
    const overlay = loadBookOverlay(db, "TSLA", "main", "auto");
    assert.equal(overlay.strikes.length, 1);
    assert.equal(overlay.strikes[0]!.strike, 400);
    assert.equal(overlay.strikes[0]!.quantity, -1);
    assert.deepEqual(overlay.expiries, ["2026-12-18"]);
  });
});

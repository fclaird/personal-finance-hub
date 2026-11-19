import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import Database from "better-sqlite3";

import { applyRuntimePragmas } from "@/lib/dbPragmas";
import { writeOptionGreeks } from "@/lib/schwab/schwabGreeksRefresh";
import type { UsMarketGlanceItem } from "@/app/components/terminal/MarketGlanceCard";
import { mergeGlancePayload, persistGlancePayload, type GlancePayload } from "@/lib/terminal/glanceCache";
import { persistOhlcvCandles } from "@/lib/terminal/ohlcv";

/**
 * Series lengths follow the charts the server actually stores:
 * one RTH session is 78 five-minute bars, the post-close tail is about 48,
 * and a CME equity-index session is about 23h of five-minute bars (276).
 * Card counts follow buildGlancePayload: portfolio + Nasdaq + S&P, nine
 * alternate tiles, and four futures tiles.
 */
const RTH_BARS = 78;
const POST_BARS = 48;
const CME_BARS = 23 * 12;
const FLAVORS = 3;
const MINUTE_TICKS = 10;

function walBytes(dbPath: string): number {
  try {
    return fs.statSync(`${dbPath}-wal`).size;
  } catch {
    return 0;
  }
}

function openDb(schema: string): { dir: string; dbPath: string; db: Database.Database } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fh-write-"));
  const dbPath = path.join(dir, "hub.sqlite");
  const db = new Database(dbPath);
  applyRuntimePragmas(db);
  db.exec(schema);
  return { dir, dbPath, db };
}

function checkpoint(db: Database.Database): void {
  db.pragma("wal_checkpoint(TRUNCATE)");
}

function points(n: number, close0: number): UsMarketGlanceItem["series"] {
  const out: UsMarketGlanceItem["series"] = [];
  for (let i = 0; i < n; i++) {
    out.push({ idx: i, close: close0 + i * 0.01, tsMs: 1_763_000_000_000 + i * 300_000 });
  }
  return out;
}

function glanceItem(id: string, seriesN: number, extN: number, last: number): UsMarketGlanceItem {
  const item: UsMarketGlanceItem = {
    id,
    label: id,
    symbol: id.toUpperCase(),
    last,
    change: last - 99,
    changePct: (last - 99) / 99,
    previousClose: 99,
    series: points(seriesN, 100),
  };
  if (extN > 0) item.extendedSeries = points(extN, 101);
  return item;
}

function realisticGlance(last: number, updatedAt: string): GlancePayload {
  const equity = (id: string) => glanceItem(id, RTH_BARS, POST_BARS, last);
  const future = (id: string) => glanceItem(id, CME_BARS, 0, last);
  return {
    ok: true,
    session: {
      headline: "U.S. MARKETS",
      detail: "Regular session",
      isOpen: true,
      sessionYmd: "2026-11-18",
      chartYmd: "2026-11-18",
      sessionLabel: "Wed",
      showingPriorSession: false,
    },
    items: [equity("portfolio"), equity("nasdaq"), equity("sp500")],
    alternateGlanceItems: [
      equity("russell2000"),
      future("gold"),
      equity("bitcoin"),
      equity("ethereum"),
      equity("vix"),
      future("wti"),
      glanceItem("nikkei", 60, 0, last),
      glanceItem("ftse", 84, 0, last),
      future("russell-emini"),
    ],
    futuresGlanceItems: [
      glanceItem("jp-n225", 60, 0, last),
      future("us-es"),
      future("us-nq"),
      equity("russell2000-futures"),
    ],
    updatedAt,
  };
}

describe("production disk writers", () => {
  it("measures glance, candle, greek, and transaction rewrites", () => {
    const summary: Record<string, number> = {};

    const glance = openDb(`
      CREATE TABLE glance_cache (
        cache_key TEXT NOT NULL,
        session_ymd TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (cache_key, session_ymd)
      );
      CREATE TABLE glance_cache_series (
        cache_key TEXT NOT NULL,
        session_ymd TEXT NOT NULL,
        series_json TEXT NOT NULL,
        PRIMARY KEY (cache_key, session_ymd)
      );
    `);
    const naive = openDb(`
      CREATE TABLE glance_cache (
        cache_key TEXT NOT NULL,
        session_ymd TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (cache_key, session_ymd)
      );
    `);
    try {
      const first = realisticGlance(100, "2026-11-18T19:00:00.000Z");
      const stored = persistGlancePayload(glance.db, "us-markets:f0", "2026-11-18", first);
      summary.glanceShellBytes = stored.shellBytes;
      summary.glanceSeriesBytes = stored.seriesBytes;
      for (let flavor = 1; flavor < FLAVORS; flavor++) {
        persistGlancePayload(glance.db, `us-markets:f${flavor}`, "2026-11-18", first);
      }
      const roundTrip = glance.db
        .prepare(
          `SELECT c.payload_json, s.series_json FROM glance_cache c
           JOIN glance_cache_series s ON s.cache_key = c.cache_key AND s.session_ymd = c.session_ymd
           WHERE c.cache_key = 'us-markets:f0'`,
        )
        .get() as { payload_json: string; series_json: string };
      const merged = mergeGlancePayload(
        JSON.parse(roundTrip.payload_json) as GlancePayload,
        JSON.parse(roundTrip.series_json),
      );
      assert.equal(merged.items[1]?.series.length, RTH_BARS);
      assert.equal(merged.futuresGlanceItems[1]?.series.length, CME_BARS);

      const seedNaive = naive.db.prepare(`
        INSERT INTO glance_cache (cache_key, session_ymd, payload_json, updated_at)
        VALUES (@cache_key, @session_ymd, @payload_json, @updated_at)
      `);
      for (let flavor = 0; flavor < FLAVORS; flavor++) {
        seedNaive.run({
          cache_key: `us-markets:f${flavor}`,
          session_ymd: "2026-11-18",
          payload_json: JSON.stringify(first),
          updated_at: first.updatedAt,
        });
      }
      checkpoint(glance.db);
      checkpoint(naive.db);
      const naiveWrite = naive.db.prepare(`
        INSERT INTO glance_cache (cache_key, session_ymd, payload_json, updated_at)
        VALUES (@cache_key, @session_ymd, @payload_json, @updated_at)
        ON CONFLICT(cache_key, session_ymd) DO UPDATE SET
          payload_json = excluded.payload_json,
          updated_at = excluded.updated_at
      `);
      const glanceBefore = walBytes(glance.dbPath);
      const naiveBefore = walBytes(naive.dbPath);
      for (let tick = 1; tick <= MINUTE_TICKS; tick++) {
        const at = `2026-11-18T19:${String(tick).padStart(2, "0")}:00.000Z`;
        const payload = realisticGlance(100 + tick * 0.05, at);
        for (let flavor = 0; flavor < FLAVORS; flavor++) {
          const key = `us-markets:f${flavor}`;
          const result = persistGlancePayload(glance.db, key, "2026-11-18", payload);
          assert.equal(result.wroteSeries, false, `series rewritten on tick ${tick}`);
          assert.equal(result.wroteShell, true);
          naiveWrite.run({
            cache_key: key,
            session_ymd: "2026-11-18",
            payload_json: JSON.stringify(payload),
            updated_at: at,
          });
        }
      }
      summary.glancePriceTickWalBytes = walBytes(glance.dbPath) - glanceBefore;
      summary.glanceFullJsonWalBytes = walBytes(naive.dbPath) - naiveBefore;
      assert.ok(
        summary.glancePriceTickWalBytes < summary.glanceSeriesBytes * 2,
        `price ticks wrote ${summary.glancePriceTickWalBytes}, one series blob is ${summary.glanceSeriesBytes}`,
      );
      assert.ok(
        summary.glanceFullJsonWalBytes > summary.glancePriceTickWalBytes * 5,
        `full json ${summary.glanceFullJsonWalBytes} vs price ticks ${summary.glancePriceTickWalBytes}`,
      );
    } finally {
      glance.db.close();
      naive.db.close();
      fs.rmSync(glance.dir, { recursive: true, force: true });
      fs.rmSync(naive.dir, { recursive: true, force: true });
    }

    const bars = openDb(`
      CREATE TABLE ohlcv_points (
        provider TEXT NOT NULL,
        symbol TEXT NOT NULL,
        interval TEXT NOT NULL,
        ts_ms INTEGER NOT NULL,
        open REAL, high REAL, low REAL, close REAL, volume REAL,
        PRIMARY KEY (provider, symbol, interval, ts_ms)
      );
    `);
    try {
      const symbols = 40;
      const perSymbol = 390;
      const candlesFor = (symbolIndex: number) =>
        Array.from({ length: perSymbol }, (_, i) => ({
          ts_ms: 1_763_000_000_000 + i * 300_000,
          open: 100 + symbolIndex,
          high: 101 + symbolIndex,
          low: 99 + symbolIndex,
          close: 100.5 + symbolIndex,
          volume: 1_000_000 + i,
        }));
      for (let s = 0; s < symbols; s++) {
        persistOhlcvCandles(bars.db, `S${s}`, "5m", candlesFor(s));
      }
      summary.ohlcvBars = symbols * perSymbol;
      checkpoint(bars.db);
      const before = walBytes(bars.dbPath);
      let unchanged = 0;
      for (let s = 0; s < symbols; s++) {
        unchanged += persistOhlcvCandles(bars.db, `S${s}`, "5m", candlesFor(s)).unchanged;
      }
      summary.ohlcvIdenticalWalBytes = walBytes(bars.dbPath) - before;
      assert.equal(unchanged, symbols * perSymbol);
      assert.ok(summary.ohlcvIdenticalWalBytes < 4096, `identical candles grew WAL by ${summary.ohlcvIdenticalWalBytes}`);

      const naiveUpsert = bars.db.prepare(`
        INSERT INTO ohlcv_points (provider, symbol, interval, ts_ms, open, high, low, close, volume)
        VALUES ('schwab', @symbol, '5m', @ts_ms, @open, @high, @low, @close, @volume)
        ON CONFLICT(provider, symbol, interval, ts_ms) DO UPDATE SET
          open=excluded.open, high=excluded.high, low=excluded.low, close=excluded.close, volume=excluded.volume
      `);
      checkpoint(bars.db);
      const naiveBefore = walBytes(bars.dbPath);
      const tx = bars.db.transaction(() => {
        for (let s = 0; s < symbols; s++) {
          for (const c of candlesFor(s)) naiveUpsert.run({ symbol: `S${s}`, ...c });
        }
      });
      tx();
      summary.ohlcvFullRewriteWalBytes = walBytes(bars.dbPath) - naiveBefore;
      // SQLite does not dirty a page when an UPSERT assigns the same OHLC values.
      assert.equal(summary.ohlcvFullRewriteWalBytes, 0);
    } finally {
      bars.db.close();
      fs.rmSync(bars.dir, { recursive: true, force: true });
    }

    const greeks = openDb(`
      CREATE TABLE option_greeks (
        id TEXT PRIMARY KEY,
        position_id TEXT NOT NULL UNIQUE,
        delta REAL, gamma REAL, theta REAL, vega REAL, iv REAL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    try {
      const rows = Array.from({ length: 200 }, (_, i) => ({
        position_id: `pos-${i}`,
        delta: 0.15 + i / 10_000,
        gamma: 0.01,
        theta: -0.02,
        vega: 0.08,
        iv: 0.25,
      }));
      assert.equal(writeOptionGreeks(greeks.db, rows).written, 200);
      checkpoint(greeks.db);
      const before = walBytes(greeks.dbPath);
      const second = writeOptionGreeks(greeks.db, rows);
      summary.greekIdenticalWalBytes = walBytes(greeks.dbPath) - before;
      assert.equal(second.unchanged, 200);
      assert.equal(second.written, 0);
      assert.ok(summary.greekIdenticalWalBytes < 4096);

      const bump = greeks.db.prepare(`
        UPDATE option_greeks SET updated_at = '2099-01-01T00:00:00Z' WHERE position_id = ?
      `);
      checkpoint(greeks.db);
      const bumpBefore = walBytes(greeks.dbPath);
      const bumpTx = greeks.db.transaction(() => {
        for (const row of rows) bump.run(row.position_id);
      });
      bumpTx();
      summary.greekUpdatedAtWalBytes = walBytes(greeks.dbPath) - bumpBefore;
      assert.ok(summary.greekUpdatedAtWalBytes > 0);
      assert.ok(summary.greekUpdatedAtWalBytes < 256 * 1024);
    } finally {
      greeks.db.close();
      fs.rmSync(greeks.dir, { recursive: true, force: true });
    }

    const txns = openDb(`
      CREATE TABLE broker_transactions (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        external_activity_id TEXT NOT NULL,
        raw_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(account_id, external_activity_id)
      );
    `);
    try {
      const raw = JSON.stringify({
        activityId: 1,
        type: "TRADE",
        description: "x".repeat(2800),
        transferItems: [{ instrument: { symbol: "AAPL  261218C00200000" }, amount: 1 }],
      });
      summary.transactionRawBytes = raw.length;
      const count = 400;
      summary.transactionRows = count;
      const insert = txns.db.prepare(`
        INSERT INTO broker_transactions (id, account_id, external_activity_id, raw_json, updated_at)
        VALUES (@id, 'acct', @external_activity_id, @raw_json, @updated_at)
      `);
      const rewrite = txns.db.prepare(`
        UPDATE broker_transactions
        SET raw_json = @raw_json, updated_at = @updated_at
        WHERE account_id = 'acct' AND external_activity_id = @external_activity_id
      `);
      const seed = txns.db.transaction(() => {
        for (let i = 0; i < count; i++) {
          insert.run({ id: `btx-${i}`, external_activity_id: String(i), raw_json: raw, updated_at: "t0" });
        }
      });
      seed();
      checkpoint(txns.db);
      const before = walBytes(txns.dbPath);
      const again = txns.db.transaction(() => {
        for (let i = 0; i < count; i++) {
          rewrite.run({ external_activity_id: String(i), raw_json: raw, updated_at: "t1" });
        }
      });
      again();
      summary.transactionRawRewriteWalBytes = walBytes(txns.dbPath) - before;
      assert.ok(summary.transactionRawRewriteWalBytes > count * raw.length * 0.5);
    } finally {
      txns.db.close();
      fs.rmSync(txns.dir, { recursive: true, force: true });
    }

    console.log(`PRODUCTION_WRITE_BYTES ${JSON.stringify(summary)}`);
  });
});

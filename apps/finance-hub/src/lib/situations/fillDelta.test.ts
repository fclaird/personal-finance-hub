import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";

import {
  blackScholesDelta,
  blackScholesPrice,
  impliedVolFromPrice,
} from "@/lib/options/shortStrangleRiskProfile";
import {
  deltaAtFillFromDb,
  lookupSpotNearTrade,
  parseTradeTimeMs,
} from "@/lib/situations/fillDelta";

describe("fillDelta helpers", () => {
  it("parses Schwab +0000 trade times via Date.parse-compatible normalize", () => {
    const ms = parseTradeTimeMs("2026-09-02T19:26:55+0000");
    assert.ok(ms != null);
    assert.equal(ms, Date.parse("2026-09-02T19:26:55+00:00"));
  });

  it("round-trips IV → price → IV and recovers ~15Δ put", () => {
    const spot = 368;
    const strike = 350;
    const years = 9 / 365;
    const rate = 0.045;
    const iv = 0.35;
    const px = blackScholesPrice("P", spot, strike, years, rate, iv);
    const solved = impliedVolFromPrice("P", spot, strike, years, rate, px)!;
    assert.ok(Math.abs(solved - iv) < 1e-3);
    const delta = blackScholesDelta("P", spot, strike, years, rate, solved)!;
    assert.ok(delta < 0);
    assert.ok(delta > -0.5);
  });

  it("looks up nearest 5m spot then falls back to daily", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE ohlcv_points (
        provider TEXT NOT NULL,
        symbol TEXT NOT NULL,
        interval TEXT NOT NULL,
        ts_ms INTEGER NOT NULL,
        open REAL, high REAL, low REAL, close REAL, volume REAL,
        PRIMARY KEY (provider, symbol, interval, ts_ms)
      );
    `);
    const tradeMs = Date.parse("2026-09-02T19:26:55+00:00");
    db.prepare(
      `INSERT INTO ohlcv_points (provider, symbol, interval, ts_ms, close)
       VALUES ('schwab','AVGO','5m',?, 367.99)`,
    ).run(tradeMs - 115_000);
    db.prepare(
      `INSERT INTO ohlcv_points (provider, symbol, interval, ts_ms, close)
       VALUES ('schwab','AVGO','1d',?, 368.79)`,
    ).run(tradeMs - 5 * 86400000);

    assert.equal(lookupSpotNearTrade(db, "AVGO", tradeMs), 367.99);

    const db2 = new Database(":memory:");
    db2.exec(`
      CREATE TABLE ohlcv_points (
        provider TEXT NOT NULL, symbol TEXT NOT NULL, interval TEXT NOT NULL,
        ts_ms INTEGER NOT NULL, open REAL, high REAL, low REAL, close REAL, volume REAL,
        PRIMARY KEY (provider, symbol, interval, ts_ms)
      );
    `);
    db2.prepare(
      `INSERT INTO ohlcv_points (provider, symbol, interval, ts_ms, close)
       VALUES ('schwab','BE','1d',?, 202.48)`,
    ).run(Date.parse("2026-08-20T05:00:00Z"));
    const beMs = Date.parse("2026-08-26T13:39:04+00:00");
    assert.equal(lookupSpotNearTrade(db2, "BE", beMs), 202.48);

    const delta = deltaAtFillFromDb(db, {
      underlying: "AVGO",
      right: "P",
      strike: 350,
      expiration: "2026-09-11",
      price: 7.78,
      tradeDate: "2026-09-02",
      tradeTime: "2026-09-02T19:26:55+0000",
    });
    assert.ok(delta != null && delta < 0 && delta > -0.4);
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { bollinger, bullMarketSupportBand, ema, ichimoku, sessionVwap, sma } from "@/lib/charts/indicators";

describe("sma", () => {
  it("matches a hand average of the last three closes", () => {
    // (1+2+3)/3 = 2, (2+3+4)/3 = 3, (3+4+5)/3 = 4
    const out = sma([1, 2, 3, 4, 5], 3);
    assert.deepEqual(out, [null, null, 2, 3, 4]);
  });
});

describe("ema", () => {
  it("seeds with the SMA and then applies alpha 2/(n+1)", () => {
    // period 3, alpha = 0.5. Seed at index 2 is (1+2+3)/3 = 2.
    // index 3: 0.5*4 + 0.5*2 = 3
    // index 4: 0.5*5 + 0.5*3 = 4
    const out = ema([1, 2, 3, 4, 5], 3);
    assert.equal(out[0], null);
    assert.equal(out[1], null);
    assert.equal(out[2], 2);
    assert.equal(out[3], 3);
    assert.equal(out[4], 4);
  });
});

describe("bollinger", () => {
  it("uses the population standard deviation", () => {
    // window [1, 2, 3], mean 2
    // variance ((1-2)^2 + 0 + (3-2)^2) / 3 = 2/3
    // sd = sqrt(2/3)
    const sd = Math.sqrt(2 / 3);
    const bands = bollinger([1, 2, 3], 3, 2);
    assert.equal(bands.middle[2], 2);
    assert.ok(Math.abs(bands.upper[2]! - (2 + 2 * sd)) < 1e-12);
    assert.ok(Math.abs(bands.lower[2]! - (2 - 2 * sd)) < 1e-12);
    assert.equal(bands.upper[1], null);
  });
});

describe("ichimoku", () => {
  it("computes midpoints and shifts the spans by the displacement", () => {
    const highs = [8, 6, 9, 7, 5, 10, 4, 8, 6, 7, 11, 3];
    const lows = [3, 2, 4, 1, 2, 5, 0, 3, 2, 4, 6, 1];
    const bars = highs.map((high, i) => ({
      open: i,
      high,
      low: lows[i]!,
      close: i,
    }));
    const result = ichimoku(bars, 3, 5, 8, 4);

    // Conversion at index 5 uses bars 3..5: highs 7,5,10 and lows 1,2,5.
    // (10 + 1) / 2 = 5.5
    assert.equal(result.conversion[5], 5.5);
    // Base at index 5 uses bars 1..5: highs 6,9,7,5,10 and lows 2,4,1,2,5.
    // (10 + 1) / 2 = 5.5
    assert.equal(result.base[5], 5.5);
    assert.equal(result.spanARaw[5], 5.5);
    // Span B at index 7 uses bars 0..7.
    // highs max 10, lows min 0, midpoint 5.
    assert.equal(result.spanBRaw[7], 5);

    // Displacement 4 plots those raw spans four bars later.
    assert.equal(result.spanA[5 + 4], 5.5);
    assert.equal(result.spanA[5], null);
    assert.equal(result.spanB[7 + 4], 5);
    assert.equal(result.spanA.length, bars.length + 4);

    // Lagging span drawn at index 1 is the close from four bars later.
    assert.equal(result.lagging[1], bars[5]!.close);
    assert.equal(result.lagging[bars.length - 1], null);
  });
});

describe("session vwap", () => {
  it("matches a two-bar hand cumulative and resets on the next session", () => {
    // bar 1 typical (10+8+9)/3 = 9, vwap 9
    // bar 2 typical (12+10+11)/3 = 11, pv = 9*100 + 11*100 = 2000, vwap 10
    const out = sessionVwap([
      { high: 10, low: 8, close: 9, volume: 100, session: "a" },
      { high: 12, low: 10, close: 11, volume: 100, session: "a" },
      { high: 4, low: 2, close: 3, volume: 50, session: "b" },
    ]);
    assert.equal(out[0], 9);
    assert.equal(out[1], 10);
    assert.equal(out[2], 3);
  });
});

describe("bull market support band", () => {
  it("maps a weekly 2 SMA and 2 EMA onto the daily bars without lookahead", () => {
    const bars = [
      { time: "2024-01-01", close: 10 },
      { time: "2024-01-02", close: 12 },
      { time: "2024-01-08", close: 14 },
      { time: "2024-01-15", close: 20 },
    ];
    const band = bullMarketSupportBand(bars, 2, 2);
    assert.equal(band.sma[0], null);
    assert.equal(band.sma[1], null);
    // Completed week close is 12, then 14. SMA = (12+14)/2 = 13. EMA seed is that SMA.
    assert.equal(band.sma[2], 13);
    assert.equal(band.ema[2], 13);
    // Next week: SMA (14+20)/2 = 17.
    // EMA alpha 2/3: (2/3)*20 + (1/3)*13 = 53/3.
    assert.equal(band.sma[3], 17);
    assert.ok(Math.abs(band.ema[3]! - 53 / 3) < 1e-12);
  });
});

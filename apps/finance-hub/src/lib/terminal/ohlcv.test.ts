import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateCandles,
  benchmarkPctOverlay,
  chartCandlesExcludeDeadZone,
  CHART_INTERVAL_BUCKET_MS,
  filterChartCandlesDeadZone,
  hasSufficientIntradayCandles,
} from "@/lib/terminal/ohlcv";
import type { Candle } from "@/lib/terminal/ohlcv";

test("chartCandlesExcludeDeadZone applies to 1D/5D minute intervals only", () => {
  assert.equal(chartCandlesExcludeDeadZone("1D", "5m"), true);
  assert.equal(chartCandlesExcludeDeadZone("1D", "1d"), false);
  assert.equal(chartCandlesExcludeDeadZone("1M", "5m"), false);
});

test("filterChartCandlesDeadZone removes 22:00 ET bar", () => {
  const dead = new Date("2026-05-22T22:00:00-04:00").getTime();
  const rth = new Date("2026-05-22T15:00:00-04:00").getTime();
  const out = filterChartCandlesDeadZone([
    { tsMs: dead, open: 1, high: 1, low: 1, close: 1, volume: 0 },
    { tsMs: rth, open: 1, high: 1, low: 1, close: 1, volume: 0 },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.tsMs, rth);
});

test("aggregateCandles merges 30m bars into 1h buckets", () => {
  const hour = CHART_INTERVAL_BUCKET_MS["60m"];
  const base = Math.floor(Date.parse("2026-05-27T14:00:00.000Z") / hour) * hour;
  const half = 30 * 60 * 1000;
  const candles: Candle[] = [
    { tsMs: base, open: 100, high: 101, low: 99, close: 100.5, volume: 1000 },
    { tsMs: base + half, open: 100.5, high: 103, low: 100, close: 102, volume: 1200 },
    { tsMs: base + CHART_INTERVAL_BUCKET_MS["60m"], open: 102, high: 104, low: 101, close: 103, volume: 900 },
  ];
  const out = aggregateCandles(candles, CHART_INTERVAL_BUCKET_MS["60m"]);
  assert.equal(out.length, 2);
  assert.equal(out[0]!.open, 100);
  assert.equal(out[0]!.close, 102);
  assert.equal(out[0]!.high, 103);
  assert.equal(out[0]!.low, 99);
});

test("hasSufficientIntradayCandles rejects stale prior-session bars", () => {
  const nowMs = Date.parse("2026-05-29T16:00:00.000Z");
  const yesterdayMs = Date.parse("2026-05-28T20:00:00.000Z");
  const cached = Array.from({ length: 40 }, (_, i) => ({ tsMs: yesterdayMs - i * 5 * 60 * 1000 }))
    .sort((a, b) => a.tsMs - b.tsMs);

  assert.equal(hasSufficientIntradayCandles(cached, "1D", nowMs), false);
});

test("hasSufficientIntradayCandles accepts a full fresh intraday cache", () => {
  const nowMs = Date.parse("2026-05-29T16:00:00.000Z");
  const latestMs = nowMs - 5 * 60 * 1000;
  const cached = Array.from({ length: 40 }, (_, i) => ({ tsMs: latestMs - i * 5 * 60 * 1000 }))
    .sort((a, b) => a.tsMs - b.tsMs);

  assert.equal(hasSufficientIntradayCandles(cached, "1D", nowMs), true);
});

test("aggregateCandles builds 4h from eight 30m bars", () => {
  const fourHour = CHART_INTERVAL_BUCKET_MS["240m"];
  const base = Math.floor(Date.parse("2026-05-27T12:00:00.000Z") / fourHour) * fourHour;
  const half = 30 * 60 * 1000;
  const candles: Candle[] = [];
  for (let i = 0; i < 8; i++) {
    candles.push({
      tsMs: base + i * half,
      open: 100 + i,
      high: 110 + i,
      low: 90,
      close: 105 + i,
      volume: 100,
    });
  }
  const out = aggregateCandles(candles, CHART_INTERVAL_BUCKET_MS["240m"]);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.open, 100);
  assert.equal(out[0]!.close, 112);
  assert.equal(out[0]!.high, 117);
});

test("benchmarkPctOverlay rebases to first benchmark close", () => {
  const primary: Candle[] = [
    { tsMs: 1000, open: 1, high: 1, low: 1, close: 1, volume: 0 },
    { tsMs: 2000, open: 1, high: 1, low: 1, close: 1, volume: 0 },
  ];
  const bench: Candle[] = [
    { tsMs: 900, open: 200, high: 200, low: 200, close: 200, volume: 0 },
    { tsMs: 1500, open: 210, high: 210, low: 210, close: 210, volume: 0 },
    { tsMs: 2500, open: 220, high: 220, low: 220, close: 220, volume: 0 },
  ];
  const out = benchmarkPctOverlay(bench, primary);
  assert.equal(out.length, 2);
  assert.ok(Math.abs(out[0]!.pct) < 0.01);
  assert.ok(out[1]!.pct > 4);
});

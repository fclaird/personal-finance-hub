import assert from "node:assert/strict";
import test from "node:test";

import { PERFORMANCE_BENCHMARKS, closesFromYahooChartResult } from "@/lib/market/performanceBenchmarks";
import { benchmarkIndexedPctByDate } from "@/lib/portfolio/snapshots";

test("performance benchmarks reuse glance symbols and keep distinct colors", () => {
  const byId = new Map(PERFORMANCE_BENCHMARKS.map((b) => [b.id, b]));
  assert.equal(byId.get("spy")?.symbol, "SPY");
  assert.equal(byId.get("qqq")?.symbol, "QQQ");
  assert.equal(byId.get("iwm")?.symbol, "IWM");
  assert.equal(byId.get("iwm")?.provider, "schwab");
  assert.equal(byId.get("wti")?.symbol, "CL=F");
  assert.equal(byId.get("wti")?.provider, "yahoo");
  assert.equal(byId.get("btc")?.symbol, "BTC-USD");
  assert.equal(byId.get("eth")?.symbol, "ETH-USD");
  const colors = PERFORMANCE_BENCHMARKS.map((b) => b.color);
  assert.equal(new Set(colors).size, colors.length);
});

test("closesFromYahooChartResult keeps positive daily closes", () => {
  const rows = closesFromYahooChartResult({
    timestamp: [1_704_067_200, 1_704_153_600],
    indicators: { quote: [{ close: [100, null] }] },
  });
  assert.deepEqual(rows, [{ date: "2024-01-01", close: 100 }]);
});

test("benchmarkIndexedPctByDate rebases to the close on or before the first date", () => {
  const bench = [
    { date: "2026-01-02", close: 100 },
    { date: "2026-01-05", close: 110 },
  ];
  const pct = benchmarkIndexedPctByDate(bench, ["2026-01-02", "2026-01-06"]);
  assert.equal(pct[0], 0);
  assert.ok(pct[1] != null && Math.abs(pct[1] - 10) < 1e-9);
  assert.deepEqual(benchmarkIndexedPctByDate(bench, []), []);
  assert.deepEqual(benchmarkIndexedPctByDate([], ["2026-01-02"]), [null]);
});

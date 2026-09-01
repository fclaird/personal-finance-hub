import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveHeatmapPerfView,
  underlyingDayReturnFrac,
} from "@/lib/terminal/terminalPerfDisplay";

test("underlyingDayReturnFrac uses start-of-day exposure", () => {
  assert.equal(underlyingDayReturnFrac(100, 1100), 100 / 1000);
});

test("resolveHeatmapPerfView position_pct uses aggregated day P/L", () => {
  const v = resolveHeatmapPerfView({
    mode: "position_pct",
    stockChangeFrac: 0.01,
    dayPl: 500,
    exposureMv: 10_500,
  });
  assert.equal(v.perfLabel, "+5.0%");
  assert.equal(v.colorFrac, 500 / 10_000);
});

test("resolveHeatmapPerfView position_dollars shows dollars", () => {
  const v = resolveHeatmapPerfView({
    mode: "position_dollars",
    stockChangeFrac: 0.01,
    dayPl: -250.5,
    exposureMv: 5000,
  });
  assert.equal(v.perfLabel, "$-250.50");
});

test("resolveHeatmapPerfView falls back to stock when no day P/L", () => {
  const v = resolveHeatmapPerfView({
    mode: "position_pct",
    stockChangeFrac: 0.02,
    dayPl: null,
    exposureMv: 1000,
  });
  assert.equal(v.perfLabel, "+2.0%");
  assert.equal(v.colorFrac, 0.02);
});

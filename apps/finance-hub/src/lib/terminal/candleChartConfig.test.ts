import assert from "node:assert/strict";
import test from "node:test";

import {
  chartCandleIntervalLabel,
  coerceIntervalForWindow,
  defaultIntervalForWindow,
  intervalsForWindow,
} from "@/lib/terminal/candleChartConfig";

test("chartCandleIntervalLabel maps aggregated intervals", () => {
  assert.equal(chartCandleIntervalLabel("60m"), "1h");
  assert.equal(chartCandleIntervalLabel("240m"), "4h");
  assert.equal(chartCandleIntervalLabel("5m"), "5m");
});

test("intervalsForWindow restricts 1D to intraday intervals", () => {
  const allowed = intervalsForWindow("1D");
  assert.deepEqual(allowed, ["5m", "15m", "60m"]);
  assert.equal(defaultIntervalForWindow("1D"), "5m");
});

test("coerceIntervalForWindow falls back when invalid", () => {
  assert.equal(coerceIntervalForWindow("1D", "1d"), "5m");
  assert.equal(coerceIntervalForWindow("1Y", "5m"), "1d");
});

test("5Y allows daily and weekly only", () => {
  assert.deepEqual(intervalsForWindow("5Y"), ["1d", "1wk"]);
});

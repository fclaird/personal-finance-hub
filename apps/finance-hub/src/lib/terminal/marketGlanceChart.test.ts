import assert from "node:assert/strict";
import test from "node:test";

import type { UsMarketGlanceItem } from "@/app/components/terminal/MarketGlanceCard";

import { indexedGlanceSeries, mergeGlanceSeriesForChart } from "./marketGlanceChart";

function item(
  id: string,
  series: Array<{ idx: number; close: number }>,
  previousClose: number | null,
): UsMarketGlanceItem {
  return {
    id,
    label: id,
    symbol: id,
    last: series.at(-1)?.close ?? null,
    change: null,
    changePct: null,
    previousClose,
    series,
  };
}

test("indexedGlanceSeries normalizes ETF prices to 100 at prior close", () => {
  const out = indexedGlanceSeries(
    item("sp500", [{ idx: 0, close: 501 }, { idx: 1, close: 502 }], 500),
  );
  assert.equal(out[0]!.value, 100.2);
  assert.equal(out[1]!.value, 100.4);
});

test("indexedGlanceSeries keeps portfolio series as-is", () => {
  const out = indexedGlanceSeries(
    item("portfolio", [{ idx: 0, close: 100 }, { idx: 1, close: 100.5 }], 100),
  );
  assert.deepEqual(out, [
    { idx: 0, value: 100 },
    { idx: 1, value: 100.5 },
  ]);
});

test("mergeGlanceSeriesForChart aligns different-length series", () => {
  const merged = mergeGlanceSeriesForChart([
    item("portfolio", [{ idx: 0, close: 100 }, { idx: 1, close: 101 }], 100),
    item("sp500", [{ idx: 0, close: 500 }, { idx: 1, close: 501 }, { idx: 2, close: 502 }], 500),
  ]);
  assert.equal(merged.length, 3);
  assert.equal(merged[0]!.portfolio, 100);
  assert.equal(merged[0]!.sp500, 100);
  assert.equal(merged[2]!.portfolio, 101);
  assert.equal(merged[2]!.sp500, 100.4);
});

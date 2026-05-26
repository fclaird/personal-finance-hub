import assert from "node:assert/strict";
import test from "node:test";

import type { UsMarketGlanceItem } from "@/app/components/terminal/MarketGlanceCard";

import { indexedGlanceSeries, indexedGlanceValueToRebasedPct, mergeGlanceSeriesForChart, formatGlanceCombinedChartTime } from "./marketGlanceChart";

function item(
  id: string,
  series: Array<{ idx: number; close: number; tsMs?: number }>,
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
    { idx: 0, value: 100, tsMs: undefined },
    { idx: 1, value: 100.5, tsMs: undefined },
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

test("mergeGlanceSeriesForChart aligns rows by timestamp when series include tsMs", () => {
  const t0 = Date.parse("2026-05-26T09:30:00-04:00");
  const t1 = Date.parse("2026-05-26T10:00:00-04:00");
  const t2 = Date.parse("2026-05-26T10:30:00-04:00");
  const merged = mergeGlanceSeriesForChart([
    item(
      "portfolio",
      [
        { idx: 0, close: 100, tsMs: t0 },
        { idx: 1, close: 100.5, tsMs: t1 },
      ],
      100,
    ),
    item(
      "sp500",
      [
        { idx: 0, close: 500, tsMs: t0 },
        { idx: 1, close: 501, tsMs: t1 },
        { idx: 2, close: 502, tsMs: t2 },
      ],
      500,
    ),
  ]);
  assert.equal(merged.length, 3);
  assert.equal(merged[0]!.tsMs, t0);
  assert.equal(merged[1]!.tsMs, t1);
  assert.equal(merged[2]!.tsMs, t2);
  assert.equal(merged[1]!.portfolio, 100.5);
  assert.equal(merged[1]!.sp500, 100.2);
});

test("formatGlanceCombinedChartTime includes ET session label", () => {
  const label = formatGlanceCombinedChartTime(Date.parse("2026-05-26T10:15:00-04:00"));
  assert.match(label, /ET$/);
  assert.match(label, /10:15/);
});

test("indexedGlanceValueToRebasedPct converts indexed glance values to day change", () => {
  const pct = indexedGlanceValueToRebasedPct(100.42);
  assert.ok(pct != null && Math.abs(pct - 0.42) < 1e-9);
  assert.equal(indexedGlanceValueToRebasedPct(null), null);
});

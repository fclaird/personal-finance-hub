import assert from "node:assert/strict";
import test from "node:test";

import type { UsMarketGlanceItem } from "@/app/components/terminal/MarketGlanceCard";

import { indexedGlanceSeries, indexedGlanceValueToRebasedPct, mergeGlanceSeriesForChart, formatGlanceCombinedChartTime, enrichOverlayPrimaryLineBands, extendedOverlayShadeRange, insertOverlaySessionCloseBridge, overlaySessionCloseRowIdx, overlayShowsExtendedSegment, indexedGlancePointsFromTile } from "./marketGlanceChart";

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

test("enrichOverlayPrimaryLineBands fills gain above prior close and loss below", () => {
  const rows = [
    { idx: 0, tsMs: 1, RKLB: 99.5 },
    { idx: 1, tsMs: 2, RKLB: 99.2 },
  ];
  const out = enrichOverlayPrimaryLineBands(rows, "RKLB", { marketOpen: true, sessionYmd: "2026-05-22" }, undefined);
  assert.equal(out[0]!.lossFill, 99.5);
  assert.equal(out[0]!.gainFill, null);
  assert.equal(out[1]!.lossFill, 99.2);
  assert.equal(out[1]!.gainFill, null);
});

test("extendedOverlayShadeRange shades after-hours when market is closed", () => {
  const sessionYmd = "2026-05-22";
  const closeMs = Date.parse("2026-05-22T16:00:00-04:00");
  const ahMs = Date.parse("2026-05-22T16:30:00-04:00");
  const rows = [
    { idx: 0, tsMs: closeMs, sp500: 100 },
    { idx: 1, tsMs: ahMs, sp500: 100.1 },
  ];
  const range = extendedOverlayShadeRange(rows, { marketOpen: false, sessionYmd });
  assert.deepEqual(range, { fromIdx: 0, toIdx: 1 });
});

test("insertOverlaySessionCloseBridge adds a 4pm row when after-hours ticks start late", () => {
  const sessionYmd = "2026-05-22";
  const rthMs = Date.parse("2026-05-22T15:59:00-04:00");
  const ahMs = Date.parse("2026-05-22T16:06:00-04:00");
  const closeMs = Date.parse("2026-05-22T16:00:00-04:00");
  const rows = [
    { idx: 0, tsMs: rthMs, RKLB: 100.2 },
    { idx: 1, tsMs: ahMs, RKLB: 100.1 },
  ];
  const bridged = insertOverlaySessionCloseBridge(rows, { marketOpen: false, sessionYmd });
  assert.equal(bridged.length, 3);
  assert.equal(bridged[1]!.tsMs, closeMs);
  assert.equal(bridged[1]!.RKLB, 100.2);
});

test("overlaySessionCloseRowIdx points at the last regular bar before after-hours", () => {
  const sessionYmd = "2026-05-22";
  const rthMs = Date.parse("2026-05-22T15:59:00-04:00");
  const ahMs = Date.parse("2026-05-22T16:06:00-04:00");
  const rows = [
    { idx: 0, tsMs: rthMs, sp500: 100 },
    { idx: 1, tsMs: ahMs, sp500: 100.1 },
  ];
  assert.equal(overlaySessionCloseRowIdx(rows, { marketOpen: false, sessionYmd }), 0);
});

test("extendedOverlayShadeRange skips shading when items have no extended segment", () => {
  const sessionYmd = "2026-05-22";
  const rows = [
    { idx: 0, tsMs: Date.parse("2026-05-22T10:00:00-04:00"), sp500: 100 },
    { idx: 1, tsMs: Date.parse("2026-05-22T11:00:00-04:00"), sp500: 100.1 },
  ];
  const range = extendedOverlayShadeRange(
    rows,
    { marketOpen: true, sessionYmd },
    [item("sp500", rows.map((r, i) => ({ idx: i, close: 100 + i * 0.1, tsMs: r.tsMs! })), 99)],
  );
  assert.equal(range, null);
});

test("overlayShowsExtendedSegment is true when any item has extended hours", () => {
  const base = item("sp500", [{ idx: 0, close: 500, tsMs: 1 }, { idx: 1, close: 501, tsMs: 2 }], 500);
  assert.equal(
    overlayShowsExtendedSegment(
      [{ ...base, extendedSeries: [{ idx: 0, close: 501, tsMs: 3 }, { idx: 1, close: 502, tsMs: 4 }], extendedPhase: "post" }],
      { marketOpen: false, sessionYmd: "2026-05-22" },
    ),
    true,
  );
});

test("indexedGlancePointsFromTile keeps after-hours timestamps from the tile row builder", () => {
  const sessionYmd = "2026-05-22";
  const rthClose = Date.parse("2026-05-22T16:00:00-04:00");
  const ah1 = Date.parse("2026-05-22T16:30:00-04:00");
  const ah2 = Date.parse("2026-05-22T17:00:00-04:00");
  const lastHour = Date.parse("2026-05-22T15:30:00-04:00");
  const equity = {
    ...item(
      "SPY",
      [
        { idx: 0, close: 499, tsMs: lastHour },
        { idx: 1, close: 500, tsMs: rthClose },
      ],
      498,
    ),
    sessionClose: 500,
    extendedSeries: [
      { idx: 1, close: 500, tsMs: rthClose },
      { idx: 2, close: 500.5, tsMs: ah1 },
      { idx: 3, close: 501, tsMs: ah2 },
    ],
    extendedPhase: "post" as const,
  };
  const windowCtx = { marketOpen: false, sessionYmd, nowMs: ah2 };
  const points = indexedGlancePointsFromTile(equity, windowCtx);
  assert.ok(points.some((p) => p.tsMs === ah1));
  assert.ok(points.some((p) => p.tsMs === ah2));
  const merged = mergeGlanceSeriesForChart([equity], windowCtx);
  assert.ok(merged.some((row) => row.tsMs === ah2));
});

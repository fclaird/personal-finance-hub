import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTileChartRows,
  enrichTileChartRowsForBaselineChart,
  formatGlanceDayPct,
  formatGlancePointTime,
  GLANCE_CHART_BASELINE,
  glancePointSegmentLabel,
  indexTileChartRows,
  indexTileChartValue,
  indexValueToDayPct,
  resolvePriorSessionClose,
  sharedSparklineYDomain,
  yDomainFromIndexedRange,
} from "@/app/components/terminal/MarketGlanceCard";
import type { UsMarketGlanceItem } from "@/app/components/terminal/MarketGlanceCard";

test("buildTileChartRows splits regular and extended columns with timestamps", () => {
  const ts1 = new Date("2026-05-22T14:00:00-04:00").getTime();
  const ts2 = new Date("2026-05-22T15:00:00-04:00").getTime();
  const ts3 = new Date("2026-05-22T16:30:00-04:00").getTime();
  const item: UsMarketGlanceItem = {
    id: "sp500",
    label: "S&P 500",
    symbol: "SPY",
    last: 502,
    change: 2,
    changePct: 0.4,
    previousClose: 500,
    series: [
      { idx: 0, close: 500.5, tsMs: ts1 },
      { idx: 1, close: 501, tsMs: ts2 },
    ],
    extendedSeries: [
      { idx: 1, close: 501, tsMs: ts2 },
      { idx: 2, close: 502, tsMs: ts3 },
    ],
    sessionClose: 501,
    extendedPhase: "post",
  };
  const rows = buildTileChartRows(item);
  assert.equal(rows[0]!.segment, "prior");
  assert.equal(rows[rows.length - 1]!.segment, "extended");
  assert.equal(rows[rows.length - 1]!.tsMs, ts3);
});

test("buildTileChartRows inserts break before pre-market after overnight gap", () => {
  const tsRth = new Date("2026-05-21T15:00:00-04:00").getTime();
  const tsClose = new Date("2026-05-21T16:00:00-04:00").getTime();
  const tsPre1 = new Date("2026-05-22T08:00:00-04:00").getTime();
  const tsPre2 = new Date("2026-05-22T08:30:00-04:00").getTime();
  const item: UsMarketGlanceItem = {
    id: "sp500",
    label: "S&P 500",
    symbol: "SPY",
    last: 502,
    change: 2,
    changePct: 0.4,
    previousClose: 500,
    series: [{ idx: 0, close: 501, tsMs: tsRth }],
    extendedSeries: [
      { idx: 0, close: 501, tsMs: tsClose },
      { idx: 1, close: 501.5, tsMs: tsPre1 },
      { idx: 2, close: 502, tsMs: tsPre2 },
    ],
    sessionClose: 501,
    extendedPhase: "pre",
  };
  const rows = buildTileChartRows(item);
  const breakRow = rows.find((r) => r.extended == null && r.regular == null && r.segment === "extended");
  assert.ok(breakRow, "expected null break row across overnight gap");
  const extRows = rows.filter((r) => r.extended != null);
  assert.ok(extRows.length >= 2);
});

test("formatGlancePointTime includes ET session label", () => {
  const label = formatGlancePointTime(new Date("2026-05-22T16:30:00-04:00").getTime(), "extended");
  assert.match(label, /ET$/);
  assert.match(label, /May/);
});

test("indexValueToDayPct converts indexed glance values to day change", () => {
  assert.equal(indexValueToDayPct(100), 0);
  assert.ok(indexValueToDayPct(100.83) != null && Math.abs(indexValueToDayPct(100.83)! - 0.83) < 1e-9);
  assert.equal(formatGlanceDayPct(0.83), "+0.83%");
  assert.equal(formatGlanceDayPct(-1.2), "-1.20%");
});

test("enrichTileChartRowsForBaselineChart splits green above and red below prior close", () => {
  const prior = 100;
  const rows = enrichTileChartRowsForBaselineChart(
    [
      { idx: 0, regular: 101, extended: null, segment: "regular" },
      { idx: 1, regular: 99, extended: null, segment: "regular" },
    ],
    prior,
  );
  assert.equal(rows[0]!.gainFill, 101);
  assert.equal(rows[0]!.lossFill, null);
  const cross = rows.find((r) => r.gainFill === prior && r.lossFill === prior);
  assert.ok(cross, "expected baseline crossing point");
  const last = rows[rows.length - 1]!;
  assert.equal(last.gainFill, null);
  assert.equal(last.lossFill, 99);
});

test("enrichTileChartRowsForBaselineChart colors extended pre-market vs prior close", () => {
  const prior = 100;
  const rows = enrichTileChartRowsForBaselineChart(
    [
      { idx: 0, regular: 100.16, extended: 100.16, segment: "regular", tsMs: 1 },
      { idx: 1, regular: null, extended: 99.35, segment: "extended", tsMs: 2 },
    ],
    prior,
  );
  assert.equal(rows[0]!.gainFill, 100.16);
  assert.equal(rows[0]!.lossFill, null);
  const cross = rows.find((r) => r.gainFill === prior && r.lossFill === prior);
  assert.ok(cross, "expected crossing from RTH gain into extended loss");
  const last = rows[rows.length - 1]!;
  assert.equal(last.gainFill, null);
  assert.equal(last.lossFill, 99.35);
});

test("buildTileChartRows anchors prior close then connects to first intraday point", () => {
  const item: UsMarketGlanceItem = {
    id: "us-cl",
    label: "WTI Crude",
    symbol: "CL=F",
    last: 91.5,
    change: -1.2,
    changePct: -1.3,
    previousClose: 96.6,
    series: [{ idx: 0, close: 91.5, tsMs: new Date("2026-05-26T03:00:00-04:00").getTime() }],
  };
  const rows = buildTileChartRows(item);
  assert.equal(rows[0]!.segment, "prior");
  assert.equal(rows[0]!.regular, 96.6);
  assert.equal(rows[1]!.regular, 91.5);
  assert.equal(rows.find((r) => r.regular == null && r.extended == null), undefined);
});

test("resolvePriorSessionClose uses previous session close baseline", () => {
  const item: UsMarketGlanceItem = {
    id: "us-cl",
    label: "WTI Crude",
    symbol: "CL=F",
    last: 91.5,
    change: -1.2,
    changePct: -1.3,
    previousClose: 96.6,
    series: [{ idx: 0, close: 91.5, tsMs: 1 }],
  };
  assert.equal(resolvePriorSessionClose(item), 96.6);
});

test("resolvePriorSessionClose uses indexed baseline for portfolio", () => {
  const item: UsMarketGlanceItem = {
    id: "portfolio",
    label: "Portfolio",
    symbol: "PORT",
    last: 99.5,
    change: -0.5,
    changePct: -0.5,
    previousClose: 100,
    valueMode: "percent",
    series: [{ idx: 0, close: 99.5 }],
  };
  assert.equal(resolvePriorSessionClose(item), 100);
});

test("glancePointSegmentLabel names session segments", () => {
  assert.equal(glancePointSegmentLabel("prior"), "Prior close");
  assert.equal(glancePointSegmentLabel("extended", "post"), "After hours");
  assert.equal(glancePointSegmentLabel("extended", "pre"), "Pre-market");
  assert.equal(glancePointSegmentLabel("regular"), "Regular session");
});

test("indexTileChartValue maps absolute prices to prior-close baseline", () => {
  assert.equal(indexTileChartValue(503, 500, false), 100.6);
  assert.equal(indexTileChartValue(100.5, 100, true), 100.5);
});

test("indexTileChartRows anchors prior close at shared baseline", () => {
  const item: UsMarketGlanceItem = {
    id: "sp500",
    label: "S&P 500",
    symbol: "SPY",
    last: 503,
    change: 3,
    changePct: 0.6,
    previousClose: 500,
    series: [{ idx: 0, close: 503, tsMs: 1 }],
  };
  const rows = indexTileChartRows(buildTileChartRows(item), item);
  assert.equal(rows[0]!.regular, GLANCE_CHART_BASELINE);
  assert.equal(rows[rows.length - 1]!.regular, 100.6);
});

test("sharedSparklineYDomain uses one scale across tiles and pins baseline low on up days", () => {
  const nasdaq: UsMarketGlanceItem = {
    id: "nasdaq",
    label: "Nasdaq",
    symbol: "QQQ",
    last: 515,
    change: 15,
    changePct: 3,
    previousClose: 500,
    series: [{ idx: 0, close: 515, tsMs: 1 }],
  };
  const sp500: UsMarketGlanceItem = {
    id: "sp500",
    label: "S&P 500",
    symbol: "SPY",
    last: 508,
    change: 8,
    changePct: 1.6,
    previousClose: 500,
    series: [{ idx: 0, close: 508, tsMs: 1 }],
  };
  const domain = sharedSparklineYDomain([sp500, nasdaq]);
  assert.ok(domain[1] > 103);
  const baselineFraction = (GLANCE_CHART_BASELINE - domain[0]!) / (domain[1]! - domain[0]!);
  assert.ok(baselineFraction < 0.2, "baseline should sit in the lower band of the chart");
  assert.ok(domain[0]! > GLANCE_CHART_BASELINE - 0.12);
});

test("yDomainFromIndexedRange pins baseline high when all values are below prior close", () => {
  const domain = yDomainFromIndexedRange(98.2, 99.8);
  const baselineFraction = (GLANCE_CHART_BASELINE - domain[0]!) / (domain[1]! - domain[0]!);
  assert.ok(baselineFraction > 0.8);
  assert.equal(domain[0], 98.2);
});

test("yDomainFromIndexedRange sets mixed extremes on the domain bounds", () => {
  const domain = yDomainFromIndexedRange(95.56, 102.52);
  assert.equal(domain[0], 95.56);
  assert.equal(domain[1], 102.52);
});

test("indexed tile chart starts on baseline and shares prior-close anchor", () => {
  const item: UsMarketGlanceItem = {
    id: "sp500",
    label: "S&P 500",
    symbol: "SPY",
    last: 503,
    change: 3,
    changePct: 0.6,
    previousClose: 500,
    series: [{ idx: 0, close: 501, tsMs: 1 }],
  };
  const rows = indexTileChartRows(buildTileChartRows(item), item);
  const enriched = enrichTileChartRowsForBaselineChart(rows, GLANCE_CHART_BASELINE);
  assert.equal(enriched[0]!.gainFill, GLANCE_CHART_BASELINE);
  assert.equal(enriched[1]!.gainFill, 100.2);
});

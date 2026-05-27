import assert from "node:assert/strict";
import test from "node:test";

import {
  applyGlanceTileChartWindow,
  GLANCE_PREMARKET_REF_START_MIN,
  GLANCE_RTH_CLOSE_MIN,
  GLANCE_RTH_LAST_HOUR_START_MIN,
  GLANCE_TILE_CHART_AXIS_HOURS,
  resolveGlanceExtendedShadeX,
  resolveGlanceTileChartAxisDomain,
  resolveGlanceTileChartWindow,
} from "@/lib/market/glanceTileChartWindow";
import { nyWallTimeMs } from "@/lib/market/futuresGlanceSession";
import type { UsMarketGlanceItem } from "@/app/components/terminal/MarketGlanceCard";

const SESSION = "2026-05-26";

function tsAt(minutes: number): number {
  return nyWallTimeMs(SESSION, minutes);
}

test("resolveGlanceTileChartWindow uses 08:30 ET when RTH is open", () => {
  const win = resolveGlanceTileChartWindow(
    { futuresKind: undefined, instrumentKind: undefined, extendedPhase: null, extendedSeries: undefined },
    { marketOpen: true, sessionYmd: SESSION },
  );
  assert.ok(win);
  assert.equal(win!.fromMs, tsAt(GLANCE_PREMARKET_REF_START_MIN));
});

test("resolveGlanceTileChartWindow uses 15:00 ET after the regular close", () => {
  const win = resolveGlanceTileChartWindow(
    {
      futuresKind: undefined,
      instrumentKind: undefined,
      extendedPhase: "post",
      extendedSeries: [{ idx: 0, close: 1, tsMs: tsAt(16 * 60 + 5) }],
    },
    { marketOpen: false, sessionYmd: SESSION },
  );
  assert.ok(win);
  assert.equal(win!.fromMs, tsAt(GLANCE_RTH_LAST_HOUR_START_MIN));
});

test("applyGlanceTileChartWindow drops regular session bars before the window", () => {
  const item: UsMarketGlanceItem = {
    id: "sp500",
    label: "S&P 500",
    symbol: "SPY",
    last: 502,
    change: 2,
    changePct: 0.4,
    previousClose: 500,
    series: [
      { idx: 0, close: 500.2, tsMs: tsAt(10 * 60) },
      { idx: 1, close: 501, tsMs: tsAt(15 * 60 + 5) },
      { idx: 2, close: 501.5, tsMs: tsAt(15 * 60 + 30) },
    ],
  };
  const trimmed = applyGlanceTileChartWindow(item, {
    fromMs: tsAt(GLANCE_RTH_LAST_HOUR_START_MIN),
    omitPriorAnchor: true,
  });
  assert.equal(trimmed.series.length, 2);
  assert.ok(trimmed.series.every((p) => (p.tsMs ?? 0) >= tsAt(GLANCE_RTH_LAST_HOUR_START_MIN)));
});

test("resolveGlanceTileChartWindow skips futures tiles", () => {
  const win = resolveGlanceTileChartWindow(
    {
      futuresKind: "cme_equity_index",
      instrumentKind: "future",
      extendedPhase: null,
      extendedSeries: undefined,
    },
    { marketOpen: false, sessionYmd: SESSION },
  );
  assert.equal(win, null);
});

test("resolveGlanceTileChartAxisDomain uses full 14 hours when no latest tick is known", () => {
  const axis = resolveGlanceTileChartAxisDomain({ marketOpen: true, sessionYmd: SESSION });
  assert.ok(axis);
  assert.equal(axis!.startMs, tsAt(GLANCE_PREMARKET_REF_START_MIN));
  assert.equal(axis!.endMs, tsAt(GLANCE_PREMARKET_REF_START_MIN) + GLANCE_TILE_CHART_AXIS_HOURS * 60 * 60 * 1000);
});

test("resolveGlanceTileChartAxisDomain grows right edge with latest data before the 14-hour cap", () => {
  const last = tsAt(10 * 60);
  const axis = resolveGlanceTileChartAxisDomain({ marketOpen: true, sessionYmd: SESSION }, undefined, last);
  assert.ok(axis);
  assert.equal(axis!.startMs, tsAt(GLANCE_PREMARKET_REF_START_MIN));
  assert.equal(axis!.endMs, last);
});

test("resolveGlanceTileChartAxisDomain post-close grows from 15:00 ET toward latest after-hours tick", () => {
  const last = tsAt(16 * 60 + 45);
  const axis = resolveGlanceTileChartAxisDomain({ marketOpen: false, sessionYmd: SESSION }, undefined, last);
  assert.ok(axis);
  assert.equal(axis!.startMs, tsAt(GLANCE_RTH_LAST_HOUR_START_MIN));
  assert.equal(axis!.endMs, last);
});

test("resolveGlanceTileChartAxisDomain clamps to 14 hours once the session span is full", () => {
  const last = tsAt(GLANCE_PREMARKET_REF_START_MIN) + GLANCE_TILE_CHART_AXIS_HOURS * 60 * 60 * 1000 + 60_000;
  const axis = resolveGlanceTileChartAxisDomain({ marketOpen: true, sessionYmd: SESSION }, undefined, last);
  assert.ok(axis);
  assert.equal(axis!.endMs, tsAt(GLANCE_PREMARKET_REF_START_MIN) + GLANCE_TILE_CHART_AXIS_HOURS * 60 * 60 * 1000);
  assert.equal(axis!.startMs, axis!.endMs - GLANCE_TILE_CHART_AXIS_HOURS * 60 * 60 * 1000);
});

test("resolveGlanceExtendedShadeX shades after-hours from 16:00 ET when closed", () => {
  const axis = resolveGlanceTileChartAxisDomain({ marketOpen: false, sessionYmd: SESSION })!;
  const shade = resolveGlanceExtendedShadeX(
    { marketOpen: false, sessionYmd: SESSION },
    axis,
    tsAt(16 * 60 + 30),
  );
  assert.ok(shade);
  assert.equal(shade!.fromMs, tsAt(GLANCE_RTH_CLOSE_MIN));
  assert.equal(shade!.toMs, tsAt(16 * 60 + 30));
});

test("resolveGlanceTileChartAxisDomain uses pre-market trim from overlay items when closed", () => {
  const last = tsAt(8 * 60 + 45);
  const axis = resolveGlanceTileChartAxisDomain(
    { marketOpen: false, sessionYmd: SESSION },
    [
      {
        futuresKind: undefined,
        instrumentKind: undefined,
        extendedPhase: "pre",
        extendedSeries: [{ idx: 0, close: 1, tsMs: last }],
      },
    ],
    last,
  );
  assert.ok(axis);
  assert.equal(axis!.startMs, tsAt(GLANCE_PREMARKET_REF_START_MIN));
  assert.equal(axis!.endMs, last);
});

test("resolveGlanceExtendedShadeX shades pre-market from axis start to 09:30 ET when open", () => {
  const axis = resolveGlanceTileChartAxisDomain({ marketOpen: true, sessionYmd: SESSION })!;
  const shade = resolveGlanceExtendedShadeX({ marketOpen: true, sessionYmd: SESSION }, axis, tsAt(12 * 60));
  assert.ok(shade);
  assert.equal(shade!.fromMs, tsAt(GLANCE_PREMARKET_REF_START_MIN));
  assert.equal(shade!.toMs, tsAt(9 * 60 + 30));
});

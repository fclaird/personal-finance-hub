import assert from "node:assert/strict";
import test from "node:test";

import {
  applyGlanceTileChartWindow,
  GLANCE_POST_MARKET_END_MIN,
  GLANCE_PREMARKET_REF_START_MIN,
  GLANCE_RTH_CLOSE_MIN,
  GLANCE_RTH_LAST_HOUR_START_MIN,
  GLANCE_RTH_OPEN_MIN,
  resolveGlanceChartWindowMode,
  resolveGlanceExtendedShadeX,
  resolveGlanceTileChartAxisDomain,
  resolveGlanceTileChartWindow,
  resolveGlanceTrimAnchorMs,
} from "@/lib/market/glanceTileChartWindow";
import { nyWallTimeMs } from "@/lib/market/futuresGlanceSession";
import type { UsMarketGlanceItem } from "@/app/components/terminal/MarketGlanceCard";

const SESSION = "2026-05-26";
const NEXT_DAY = "2026-05-27";

function tsAt(ymd: string, minutes: number): number {
  return nyWallTimeMs(ymd, minutes);
}

const equityItem = {
  futuresKind: undefined,
  instrumentKind: undefined,
  extendedPhase: null as const,
  extendedSeries: undefined,
};

test("resolveGlanceTileChartWindow uses 09:30 ET when market is open", () => {
  const win = resolveGlanceTileChartWindow(equityItem, {
    marketOpen: true,
    sessionYmd: SESSION,
    nowMs: tsAt(SESSION, 10 * 60),
  });
  assert.ok(win);
  assert.equal(win!.fromMs, tsAt(SESSION, GLANCE_RTH_OPEN_MIN));
});

test("resolveGlanceTrimAnchorMs keeps 09:30 ET during the last RTH hour when market is open", () => {
  const anchor = resolveGlanceTrimAnchorMs(
    { marketOpen: true, sessionYmd: SESSION, nowMs: tsAt(SESSION, 15 * 60 + 20) },
    equityItem,
  );
  assert.equal(anchor, tsAt(SESSION, GLANCE_RTH_OPEN_MIN));
});

test("resolveGlanceTileChartWindow uses 15:00 ET after the regular close", () => {
  const win = resolveGlanceTileChartWindow(
    {
      futuresKind: undefined,
      instrumentKind: undefined,
      extendedPhase: "post",
      extendedSeries: [{ idx: 0, close: 1, tsMs: tsAt(SESSION, 16 * 60 + 5) }],
    },
    { marketOpen: false, sessionYmd: SESSION },
  );
  assert.ok(win);
  assert.equal(win!.fromMs, tsAt(SESSION, GLANCE_RTH_LAST_HOUR_START_MIN));
});

test("resolveGlanceTrimAnchorMs uses 15:00 when showing prior session even if item phase is pre", () => {
  const anchor = resolveGlanceTrimAnchorMs(
    { marketOpen: false, sessionYmd: SESSION, showingPriorSession: true, chartYmd: NEXT_DAY },
    { futuresKind: undefined, instrumentKind: undefined, extendedPhase: "pre", extendedSeries: undefined },
  );
  assert.equal(anchor, tsAt(SESSION, GLANCE_RTH_LAST_HOUR_START_MIN));
});

test("resolveGlanceChartWindowMode overnight bridge when prior session plus live pre", () => {
  const mode = resolveGlanceChartWindowMode(
    { marketOpen: false, sessionYmd: SESSION, showingPriorSession: true, chartYmd: NEXT_DAY },
    { futuresKind: undefined, instrumentKind: undefined, extendedPhase: "pre", extendedSeries: undefined },
  );
  assert.equal(mode, "overnight_bridge");
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
      { idx: 0, close: 500.2, tsMs: tsAt(SESSION, 10 * 60) },
      { idx: 1, close: 501, tsMs: tsAt(SESSION, 15 * 60 + 5) },
      { idx: 2, close: 501.5, tsMs: tsAt(SESSION, 15 * 60 + 30) },
    ],
  };
  const trimmed = applyGlanceTileChartWindow(item, {
    fromMs: tsAt(SESSION, GLANCE_RTH_LAST_HOUR_START_MIN),
    omitPriorAnchor: true,
  });
  assert.equal(trimmed.series.length, 2);
  assert.ok(trimmed.series.every((p) => (p.tsMs ?? 0) >= tsAt(SESSION, GLANCE_RTH_LAST_HOUR_START_MIN)));
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

test("resolveGlanceTileChartAxisDomain rth live spans 09:30 to 16:00 ET", () => {
  const axis = resolveGlanceTileChartAxisDomain({
    marketOpen: true,
    sessionYmd: SESSION,
    nowMs: tsAt(SESSION, 10 * 60),
  });
  assert.ok(axis);
  assert.equal(axis!.mode, "rth_live");
  assert.equal(axis!.startMs, tsAt(SESSION, GLANCE_RTH_OPEN_MIN));
  assert.equal(axis!.endMs, tsAt(SESSION, GLANCE_RTH_CLOSE_MIN));
});

test("resolveGlanceTileChartAxisDomain rth live keeps full day window during the last hour", () => {
  const last = tsAt(SESSION, 15 * 60 + 30);
  const axis = resolveGlanceTileChartAxisDomain(
    { marketOpen: true, sessionYmd: SESSION, nowMs: last },
    undefined,
    last,
  );
  assert.ok(axis);
  assert.equal(axis!.startMs, tsAt(SESSION, GLANCE_RTH_OPEN_MIN));
  assert.equal(axis!.endMs, tsAt(SESSION, GLANCE_RTH_CLOSE_MIN));
});

test("resolveGlanceTileChartAxisDomain post-close ends at last data before 20:00 ET", () => {
  const last = tsAt(SESSION, 16 * 60 + 45);
  const axis = resolveGlanceTileChartAxisDomain(
    { marketOpen: false, sessionYmd: SESSION },
    { ...equityItem, extendedPhase: "post", extendedSeries: [{ idx: 0, close: 1, tsMs: last }] },
    last,
  );
  assert.ok(axis);
  assert.equal(axis!.mode, "post_close");
  assert.equal(axis!.startMs, tsAt(SESSION, GLANCE_RTH_LAST_HOUR_START_MIN));
  assert.equal(axis!.endMs, last);
});

test("resolveGlanceTileChartAxisDomain overnight bridge ends at last data before 09:30 open", () => {
  const last = tsAt(NEXT_DAY, 6 * 60 + 30);
  const axis = resolveGlanceTileChartAxisDomain(
    {
      marketOpen: false,
      sessionYmd: SESSION,
      chartYmd: NEXT_DAY,
      showingPriorSession: true,
      nowMs: last,
    },
    { ...equityItem, extendedPhase: "pre", extendedSeries: [{ idx: 0, close: 1, tsMs: last }] },
    last,
  );
  assert.ok(axis);
  assert.equal(axis!.mode, "overnight_bridge");
  assert.equal(axis!.startMs, tsAt(SESSION, GLANCE_RTH_LAST_HOUR_START_MIN));
  assert.equal(axis!.endMs, last);
});

test("resolveGlanceExtendedShadeX shades after-hours from 16:00 ET when closed", () => {
  const axis = resolveGlanceTileChartAxisDomain(
    { marketOpen: false, sessionYmd: SESSION },
    { ...equityItem, extendedPhase: "post", extendedSeries: [{ idx: 0, close: 1, tsMs: tsAt(SESSION, 16 * 60 + 30) }] },
  )!;
  const shade = resolveGlanceExtendedShadeX(
    { marketOpen: false, sessionYmd: SESSION },
    axis,
    tsAt(SESSION, 16 * 60 + 30),
  );
  assert.ok(shade);
  assert.equal(shade!.fromMs, tsAt(SESSION, GLANCE_RTH_CLOSE_MIN));
  assert.equal(shade!.toMs, tsAt(SESSION, 16 * 60 + 30));
});

test("resolveGlanceTileChartAxisDomain live pre-market same day uses 08:30 trim", () => {
  const last = tsAt(NEXT_DAY, 8 * 60 + 45);
  const axis = resolveGlanceTileChartAxisDomain(
    { marketOpen: false, sessionYmd: NEXT_DAY, showingPriorSession: false, nowMs: last },
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
  assert.equal(axis!.startMs, tsAt(NEXT_DAY, GLANCE_PREMARKET_REF_START_MIN));
});

test("resolveGlanceExtendedShadeX returns null during RTH for US equity", () => {
  const axis = resolveGlanceTileChartAxisDomain({
    marketOpen: true,
    sessionYmd: SESSION,
    nowMs: tsAt(SESSION, 12 * 60),
  })!;
  const shade = resolveGlanceExtendedShadeX({ marketOpen: true, sessionYmd: SESSION }, axis, tsAt(SESSION, 12 * 60));
  assert.equal(shade, null);
});

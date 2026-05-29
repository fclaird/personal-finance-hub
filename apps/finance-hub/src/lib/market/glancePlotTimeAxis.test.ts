import assert from "node:assert/strict";
import test from "node:test";

import { nyWallTimeMs } from "@/lib/market/futuresGlanceSession";
import {
  glancePlotMsToWallClock,
  isGlanceOvernightDeadZone,
  resolveGlanceOvernightGap,
  resolveGlancePlotAxis,
  wallClockToGlancePlotMs,
} from "@/lib/market/glancePlotTimeAxis";
import { GLANCE_RTH_OPEN_MIN, GLANCE_RTH_LAST_HOUR_START_MIN } from "@/lib/market/glanceTileChartWindow";

const SESSION = "2026-05-26";
const NEXT_DAY = "2026-05-27";

function tsAt(ymd: string, minutes: number): number {
  return nyWallTimeMs(ymd, minutes);
}

test("resolveGlanceOvernightGap spans 20:00 prior session to 04:00 chart day", () => {
  const gap = resolveGlanceOvernightGap({
    marketOpen: false,
    sessionYmd: SESSION,
    chartYmd: NEXT_DAY,
    showingPriorSession: true,
  });
  assert.ok(gap);
  assert.equal(gap!.fromMs, tsAt(SESSION, 20 * 60));
  assert.equal(gap!.toMs, tsAt(NEXT_DAY, 4 * 60));
  assert.equal(gap!.skipMs, 8 * 60 * 60 * 1000);
});

test("wallClockToGlancePlotMs collapses 04:00 pre to immediately after 20:00 AH", () => {
  const ctx = { marketOpen: false, sessionYmd: SESSION, chartYmd: NEXT_DAY, showingPriorSession: true };
  const ahEnd = tsAt(SESSION, 20 * 60);
  const preStart = tsAt(NEXT_DAY, 4 * 60);
  assert.equal(wallClockToGlancePlotMs(preStart, ctx, "overnight_bridge"), ahEnd);
});

test("isGlanceOvernightDeadZone marks 20:00–04:00 as non-plottable", () => {
  const ctx = { marketOpen: false, sessionYmd: SESSION, chartYmd: NEXT_DAY, showingPriorSession: true };
  assert.equal(isGlanceOvernightDeadZone(tsAt(SESSION, 22 * 60), ctx, "overnight_bridge"), true);
  assert.equal(isGlanceOvernightDeadZone(tsAt(SESSION, 19 * 60), ctx, "overnight_bridge"), false);
  assert.equal(isGlanceOvernightDeadZone(tsAt(NEXT_DAY, 5 * 60), ctx, "overnight_bridge"), false);
});

test("resolveGlancePlotAxis overnight bridge excises dead zone from plot span", () => {
  const ctx = {
    marketOpen: false,
    sessionYmd: SESSION,
    chartYmd: NEXT_DAY,
    showingPriorSession: true,
    nowMs: tsAt(NEXT_DAY, 6 * 60 + 30),
  };
  const axis = resolveGlancePlotAxis(
    ctx,
    { futuresKind: undefined, instrumentKind: undefined, extendedPhase: "pre", extendedSeries: undefined },
    tsAt(NEXT_DAY, 6 * 60 + 30),
  );
  assert.ok(axis);
  assert.equal(axis!.mode, "overnight_bridge");
  assert.equal(axis!.compress, true);
  const wallSpan = axis!.wallEndMs - axis!.wallStartMs;
  const plotSpan = axis!.plotEndMs - axis!.plotStartMs;
  assert.ok(plotSpan < wallSpan);
  assert.equal(axis!.wallStartMs, tsAt(SESSION, GLANCE_RTH_LAST_HOUR_START_MIN));
  assert.equal(axis!.wallEndMs, tsAt(NEXT_DAY, 6 * 60 + 30));
});

test("glancePlotMsToWallClock inverts compressed coordinates", () => {
  const ctx = { marketOpen: false, sessionYmd: SESSION, chartYmd: NEXT_DAY, showingPriorSession: true };
  const wall = tsAt(NEXT_DAY, 6 * 60 + 15);
  const plot = wallClockToGlancePlotMs(wall, ctx, "overnight_bridge");
  assert.equal(glancePlotMsToWallClock(plot, ctx, "overnight_bridge"), wall);
});

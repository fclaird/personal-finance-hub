import assert from "node:assert/strict";
import test from "node:test";

import { nyWallTimeMs } from "@/lib/market/futuresGlanceSession";
import { indexTileChartRows } from "@/lib/market/glanceTileChartRows";
import type { UsMarketGlanceItem } from "@/app/components/terminal/MarketGlanceCard";
import {
  applyClosedSessionFuturesView,
  buildPostCashClosePlot,
  glanceMiniChartState,
  glanceReferenceLineXs,
  glanceTimeFraction,
  resolveGlanceInstrumentId,
} from "@/lib/market/glanceMiniChartSession";

const RTH_OPEN = 9 * 60 + 30;
const RTH_CLOSE = 16 * 60;

function at(iso: string): Date {
  return new Date(iso);
}

test("glanceTimeFraction places 11:00 at 1.5h of the 6.5h regular session", () => {
  const ymd = "2026-05-20";
  const start = nyWallTimeMs(ymd, RTH_OPEN);
  const end = nyWallTimeMs(ymd, RTH_CLOSE);
  const eleven = nyWallTimeMs(ymd, 11 * 60);
  const mid = nyWallTimeMs(ymd, 12 * 60 + 45);
  assert.ok(Math.abs(glanceTimeFraction(eleven, start, end) - 1.5 / 6.5) < 1e-12);
  assert.ok(Math.abs(glanceTimeFraction(mid, start, end) - 0.5) < 1e-12);
  assert.equal(glanceTimeFraction(start, start, end), 0);
  assert.equal(glanceTimeFraction(end, start, end), 1);
  const [x1, x2] = glanceReferenceLineXs(start, end);
  assert.equal(x1, start);
  assert.equal(x2, end);
});

test("mid-session weekday stays on cash symbols with the previous-close reference", () => {
  const now = at("2026-05-20T15:00:00.000Z"); // 11:00 ET
  const state = glanceMiniChartState(now);
  assert.equal(state.phase, "rth");
  assert.equal(state.cashSessionOpen, true);
  assert.equal(state.reference, "previous_close");
  assert.equal(state.lockedSessionYmd, "2026-05-20");
  assert.equal(state.closedPlotStartMs, null);
  assert.equal(resolveGlanceInstrumentId("nasdaq", now), "nasdaq");
  assert.equal(resolveGlanceInstrumentId("sp500", now), "sp500");
  assert.equal(resolveGlanceInstrumentId("russell2000", now), "russell2000");
  assert.equal(state.rthStartMs, nyWallTimeMs("2026-05-20", RTH_OPEN));
  assert.equal(state.rthEndMs, nyWallTimeMs("2026-05-20", RTH_CLOSE));
  const eleven = nyWallTimeMs("2026-05-20", 11 * 60);
  assert.ok(Math.abs(glanceTimeFraction(eleven, state.rthStartMs, state.rthEndMs) - 1.5 / 6.5) < 1e-12);
});

test("just before 16:00 is still the regular session", () => {
  const now = at("2026-05-20T19:59:00.000Z"); // 15:59 ET
  const state = glanceMiniChartState(now);
  assert.equal(state.phase, "rth");
  assert.equal(state.reference, "previous_close");
  assert.equal(resolveGlanceInstrumentId("sp500", now), "sp500");
  const frac = glanceTimeFraction(now.getTime(), state.rthStartMs, state.rthEndMs);
  assert.ok(frac > 0.99 && frac < 1);
});

test("just after 16:00 switches to futures and locks today's cash close", () => {
  const now = at("2026-05-20T20:00:30.000Z"); // 16:00:30 ET
  const state = glanceMiniChartState(now);
  assert.equal(state.phase, "post_close");
  assert.equal(state.cashSessionOpen, false);
  assert.equal(state.reference, "locked_session_close");
  assert.equal(state.lockedSessionYmd, "2026-05-20");
  assert.equal(resolveGlanceInstrumentId("nasdaq", now), "us-nq");
  assert.equal(resolveGlanceInstrumentId("sp500", now), "us-es");
  assert.equal(resolveGlanceInstrumentId("russell2000", now), "us-rty");
  assert.equal(state.closedPlotStartMs, nyWallTimeMs("2026-05-20", RTH_CLOSE));
  assert.equal(state.closedPlotEndMs, nyWallTimeMs("2026-05-21", RTH_OPEN));
});

test("Friday 20:00 ET keeps Friday's close and the e-mini proxies", () => {
  const now = at("2026-05-23T00:00:00.000Z"); // Fri 20:00 ET
  const state = glanceMiniChartState(now);
  assert.equal(state.phase, "overnight");
  assert.equal(state.lockedSessionYmd, "2026-05-22");
  assert.equal(state.reference, "locked_session_close");
  assert.equal(resolveGlanceInstrumentId("nasdaq", now), "us-nq");
  assert.equal(resolveGlanceInstrumentId("sp500", now), "us-es");
  assert.equal(state.closedPlotStartMs, nyWallTimeMs("2026-05-22", RTH_CLOSE));
  // Monday May 25 2026 is Memorial Day, so the next cash open is Tuesday.
  assert.equal(state.closedPlotEndMs, nyWallTimeMs("2026-05-26", RTH_OPEN));
});

test("Saturday stays on Friday's locked close", () => {
  const now = at("2026-05-23T16:00:00.000Z"); // Sat 12:00 ET
  const state = glanceMiniChartState(now);
  assert.equal(state.phase, "weekend");
  assert.equal(state.globexPhase, "closed");
  assert.equal(state.lockedSessionYmd, "2026-05-22");
  assert.equal(state.reference, "locked_session_close");
  assert.equal(resolveGlanceInstrumentId("sp500", now), "us-es");
  assert.equal(state.closedPlotEndMs, nyWallTimeMs("2026-05-26", RTH_OPEN));
});

test("Sunday 17:59 ET is Globex-closed and 18:01 ET is Globex-open, cash close still Friday", () => {
  const before = at("2026-05-24T21:59:00.000Z"); // Sun 17:59 ET
  const after = at("2026-05-24T22:01:00.000Z"); // Sun 18:01 ET
  const early = glanceMiniChartState(before);
  const open = glanceMiniChartState(after);
  assert.equal(early.phase, "weekend");
  assert.equal(open.phase, "weekend");
  assert.equal(early.globexPhase, "closed");
  assert.equal(open.globexPhase, "tradable");
  assert.equal(early.lockedSessionYmd, "2026-05-22");
  assert.equal(open.lockedSessionYmd, "2026-05-22");
  assert.equal(early.reference, "locked_session_close");
  assert.equal(open.reference, "locked_session_close");
  assert.equal(early.closedPlotStartMs, open.closedPlotStartMs);
  assert.equal(open.closedPlotEndMs, nyWallTimeMs("2026-05-26", RTH_OPEN));
  assert.equal(resolveGlanceInstrumentId("nasdaq", after), "us-nq");
});

test("Monday 09:29 ET is still the locked Friday close; 09:31 ET is cash RTH", () => {
  const pre = at("2026-05-18T13:29:00.000Z"); // Mon May 18 09:29 ET (not a holiday)
  const rth = at("2026-05-18T13:31:00.000Z"); // 09:31 ET
  const before = glanceMiniChartState(pre);
  const after = glanceMiniChartState(rth);
  assert.equal(before.phase, "premarket");
  assert.equal(before.lockedSessionYmd, "2026-05-15");
  assert.equal(before.reference, "locked_session_close");
  assert.equal(resolveGlanceInstrumentId("sp500", pre), "us-es");
  assert.equal(before.closedPlotEndMs, nyWallTimeMs("2026-05-18", RTH_OPEN));
  assert.equal(after.phase, "rth");
  assert.equal(after.reference, "previous_close");
  assert.equal(after.lockedSessionYmd, "2026-05-18");
  assert.equal(resolveGlanceInstrumentId("nasdaq", rth), "nasdaq");
  assert.equal(resolveGlanceInstrumentId("sp500", rth), "sp500");
  assert.equal(resolveGlanceInstrumentId("russell2000", rth), "russell2000");
});

test("Memorial Day Monday 09:31 ET stays closed on Friday's lock", () => {
  const now = at("2026-05-25T13:31:00.000Z"); // 09:31 ET on a NYSE holiday
  const state = glanceMiniChartState(now);
  assert.equal(state.phase, "holiday");
  assert.equal(state.cashSessionOpen, false);
  assert.equal(state.lockedSessionYmd, "2026-05-22");
  assert.equal(state.reference, "locked_session_close");
  assert.equal(resolveGlanceInstrumentId("nasdaq", now), "us-nq");
  assert.equal(state.closedPlotEndMs, nyWallTimeMs("2026-05-26", RTH_OPEN));
});

test("pre-market 04:00 ET Monday is futures against Friday's close, not a new session", () => {
  const now = at("2026-05-18T08:00:00.000Z"); // Mon May 18 04:00 ET
  const state = glanceMiniChartState(now);
  assert.equal(state.phase, "premarket");
  assert.equal(state.lockedSessionYmd, "2026-05-15");
  assert.equal(resolveGlanceInstrumentId("nasdaq", now), "us-nq");
  assert.equal(state.closedPlotStartMs, nyWallTimeMs("2026-05-15", RTH_CLOSE));
});

test("NYSE holiday uses the prior session close and e-mini proxies", () => {
  const now = at("2026-09-07T15:00:00.000Z"); // Labor Day 11:00 ET
  const state = glanceMiniChartState(now);
  assert.equal(state.phase, "holiday");
  assert.equal(state.cashSessionOpen, false);
  assert.equal(state.lockedSessionYmd, "2026-09-04");
  assert.equal(state.reference, "locked_session_close");
  assert.equal(resolveGlanceInstrumentId("sp500", now), "us-es");
  assert.equal(resolveGlanceInstrumentId("nasdaq", now), "us-nq");
  assert.equal(state.closedPlotStartMs, nyWallTimeMs("2026-09-04", RTH_CLOSE));
  assert.equal(state.closedPlotEndMs, nyWallTimeMs("2026-09-08", RTH_OPEN));
});

test("DST fall-back weekend keeps Friday's cash close until Monday 09:30 ET", () => {
  const saturday = glanceMiniChartState(at("2026-10-31T16:00:00.000Z")); // Sat 12:00 EDT
  const before = glanceMiniChartState(at("2026-11-01T22:59:00.000Z")); // Sun 17:59 EST
  const after = glanceMiniChartState(at("2026-11-01T23:01:00.000Z")); // Sun 18:01 EST
  assert.equal(saturday.phase, "weekend");
  assert.equal(saturday.lockedSessionYmd, "2026-10-30");
  assert.equal(before.globexPhase, "closed");
  assert.equal(after.globexPhase, "tradable");
  assert.equal(before.lockedSessionYmd, "2026-10-30");
  assert.equal(after.lockedSessionYmd, "2026-10-30");
  assert.equal(after.reference, "locked_session_close");
  const closeMs = nyWallTimeMs("2026-10-30", RTH_CLOSE);
  const openMs = nyWallTimeMs("2026-11-02", RTH_OPEN);
  assert.equal(after.closedPlotStartMs, closeMs);
  assert.equal(after.closedPlotEndMs, openMs);
  // Fall back inserts an hour, so the UTC span is longer than 65.5 wall hours.
  const span = openMs - closeMs;
  assert.ok(Math.abs(span - 66.5 * 60 * 60 * 1000) < 1000);
  const sundayTick = nyWallTimeMs("2026-11-01", 18 * 60 + 1);
  const frac = glanceTimeFraction(sundayTick, closeMs, openMs);
  assert.ok(frac > 0 && frac < 1);
  assert.equal(resolveGlanceInstrumentId("sp500", at("2026-11-01T23:01:00.000Z")), "us-es");
});

test("instruments without a cash-index proxy stay put when the cash session is closed", () => {
  const now = at("2026-05-23T00:00:00.000Z");
  for (const id of ["us-cl", "gold", "bitcoin", "ethereum", "vix", "jp-n225", "ftse100", "us-es", "us-nq", "portfolio"]) {
    assert.equal(resolveGlanceInstrumentId(id, now), id);
  }
});

test("post-cash plot starts at the bell and drops the cash-session path", () => {
  const friday = "2026-05-22";
  const points = [
    { tsMs: nyWallTimeMs(friday, 10 * 60), close: 7600 },
    { tsMs: nyWallTimeMs(friday, 15 * 60 + 59), close: 7660 },
    { tsMs: nyWallTimeMs(friday, 16 * 60 + 30), close: 7664 },
    { tsMs: nyWallTimeMs(friday, 17 * 60 + 30), close: 9999 },
    { tsMs: nyWallTimeMs("2026-05-24", 18 * 60 + 1), close: 7670 },
  ];
  const fridayNight = buildPostCashClosePlot(points, at("2026-05-23T00:00:00.000Z"));
  assert.ok(fridayNight);
  assert.equal(fridayNight!.referencePrice, 7660);
  assert.equal(fridayNight!.lockedSessionYmd, friday);
  assert.ok(fridayNight!.points.every((p) => p.tsMs >= fridayNight!.cashCloseMs));
  assert.equal(fridayNight!.points[0]!.close, 7660);
  assert.equal(fridayNight!.points.some((p) => p.close === 7600), false);
  assert.equal(fridayNight!.points.some((p) => p.close === 9999), false);
  assert.equal(fridayNight!.points.some((p) => p.close === 7664), true);
  assert.equal(fridayNight!.points.some((p) => p.close === 7670), false);

  const sunday = buildPostCashClosePlot(points, at("2026-05-24T22:05:00.000Z"));
  assert.ok(sunday);
  assert.equal(sunday!.referencePrice, 7660);
  assert.equal(sunday!.points.some((p) => p.close === 7670), true);
  assert.equal(sunday!.points.some((p) => p.close === 7600), false);
  const tick = sunday!.points.find((p) => p.close === 7670)!;
  const frac = glanceTimeFraction(tick.tsMs, sunday!.cashCloseMs, sunday!.nextOpenMs);
  assert.ok(frac > 0.5 && frac < 1);

  assert.equal(buildPostCashClosePlot(points, at("2026-05-22T15:00:00.000Z")), null);
});

test("closed-session futures view keeps Globex day % and reindexes the chart to the locked close", () => {
  const friday = "2026-05-22";
  const plot = buildPostCashClosePlot(
    [
      { tsMs: nyWallTimeMs(friday, 15 * 60), close: 7600 },
      { tsMs: nyWallTimeMs(friday, 16 * 60 + 20), close: 7610 },
    ],
    at("2026-05-23T00:00:00.000Z"),
  );
  assert.ok(plot);
  const card = {
    id: "us-es",
    label: "S&P 500 E-mini",
    symbol: "ES=F",
    last: 7666.5,
    change: 68,
    changePct: 0.895,
    previousClose: 7598.5,
    series: [
      { idx: 0, close: 7600, tsMs: nyWallTimeMs(friday, 10 * 60) },
      { idx: 1, close: 7610, tsMs: nyWallTimeMs(friday, 16 * 60 + 20) },
    ],
    extendedSeries: [{ idx: 1, close: 7610, tsMs: 1 }, { idx: 2, close: 7620, tsMs: 2 }],
    postCashClose: plot,
    valueMode: "price" as const,
  };
  const view = applyClosedSessionFuturesView(card, at("2026-05-23T00:00:00.000Z"));
  assert.equal(view.changePct, 0.895);
  assert.equal(view.previousClose, 7598.5);
  assert.equal(view.chartReferencePrice, 7600);
  assert.equal(view.extendedSeries, undefined);
  assert.ok(view.series.every((p) => (p.tsMs ?? 0) >= plot!.cashCloseMs));
  assert.equal(view.series.some((p) => p.close === 7600 && (p.tsMs ?? 0) < plot!.cashCloseMs), false);
  assert.equal(view.timeAxis?.startMs, plot!.cashCloseMs);
  assert.equal(view.timeAxis?.endMs, plot!.nextOpenMs);

  const rows = indexTileChartRows(
    view.series.map((p) => ({
      idx: p.idx,
      regular: p.close,
      extended: null,
      tsMs: p.tsMs,
      segment: "regular" as const,
    })),
    view as unknown as UsMarketGlanceItem,
  );
  assert.ok(Math.abs((rows[0]!.regular ?? 0) - 100) < 1e-9);

  const duringRth = applyClosedSessionFuturesView(card, at("2026-05-22T15:00:00.000Z"));
  assert.equal(duringRth.series.length, card.series.length);
  assert.equal(duringRth.chartReferencePrice, undefined);
});

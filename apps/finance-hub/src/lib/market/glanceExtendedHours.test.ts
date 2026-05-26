import assert from "node:assert/strict";
import test from "node:test";

import {
  glanceChartContext,
  nyBarPhase,
  resolveGlanceSplitContext,
  splitTimedPointsForGlance,
  usEquityExtendedHoursPhase,
} from "./glanceExtendedHours";

test("usEquityExtendedHoursPhase detects pre-market and after-hours", () => {
  const pre = new Date("2026-05-22T12:00:00.000Z"); // 08:00 ET
  const post = new Date("2026-05-22T21:30:00.000Z"); // 17:30 ET
  const rth = new Date("2026-05-22T15:00:00.000Z"); // 11:00 ET
  assert.equal(usEquityExtendedHoursPhase(pre), "pre");
  assert.equal(usEquityExtendedHoursPhase(post), "post");
  assert.equal(usEquityExtendedHoursPhase(rth), null);
});

test("glanceChartContext uses today for after-hours", () => {
  const post = new Date("2026-05-22T21:30:00.000Z");
  const ctx = glanceChartContext(post);
  assert.equal(ctx.extendedPhase, "post");
  assert.equal(ctx.showExtended, true);
  assert.equal(ctx.sessionYmd, "2026-05-22");
});

test("resolveGlanceSplitContext ignores pre/post bars during RTH", () => {
  const rth = new Date("2026-05-26T13:38:00.000Z"); // 09:38 ET Tue
  const ctx = glanceChartContext(rth);
  assert.equal(ctx.showExtended, false);
  const sessionYmd = ctx.sessionYmd;
  const points = [
    { tsMs: new Date(`${sessionYmd}T08:00:00-04:00`).getTime(), close: 500 },
    { tsMs: new Date(`${sessionYmd}T09:35:00-04:00`).getTime(), close: 501 },
  ];
  const splitCtx = resolveGlanceSplitContext(ctx, points, rth);
  assert.equal(splitCtx.showExtended, false);
  assert.equal(splitCtx.extendedPhase, null);
});

test("resolveGlanceSplitContext enables post split from timed bars after live extended window", () => {
  const sessionYmd = "2026-05-22";
  const afterHours = new Date(`${sessionYmd}T17:30:00-04:00`);
  const points = [
    { tsMs: new Date(`${sessionYmd}T15:00:00-04:00`).getTime(), close: 501 },
    { tsMs: new Date(`${sessionYmd}T16:30:00-04:00`).getTime(), close: 502 },
  ];
  const ctx = {
    sessionYmd,
    chartYmd: sessionYmd,
    extendedPhase: null,
    showExtended: false,
  };
  const splitCtx = resolveGlanceSplitContext(ctx, points, afterHours);
  assert.equal(splitCtx.showExtended, true);
  assert.equal(splitCtx.extendedPhase, "post");
});

test("splitTimedPointsForGlance separates regular and extended bars", () => {
  const sessionYmd = "2026-05-22";
  const mk = (h: number, m: number, close: number) => ({
    tsMs: Date.UTC(2026, 4, 22, h + 4, m, 0),
    close,
  });
  // Note: UTC offsets are simplified; use nyBarPhase-compatible timestamps
  const points = [
    { tsMs: new Date(`${sessionYmd}T14:30:00-04:00`).getTime(), close: 500 },
    { tsMs: new Date(`${sessionYmd}T15:00:00-04:00`).getTime(), close: 501 },
    { tsMs: new Date(`${sessionYmd}T16:30:00-04:00`).getTime(), close: 502 },
    { tsMs: new Date(`${sessionYmd}T17:00:00-04:00`).getTime(), close: 503 },
  ];
  assert.equal(nyBarPhase(points[0]!.tsMs, sessionYmd), "regular");
  assert.equal(nyBarPhase(points[2]!.tsMs, sessionYmd), "post");

  const split = splitTimedPointsForGlance(points, {
    sessionYmd,
    chartYmd: sessionYmd,
    extendedPhase: "post",
    showExtended: true,
  });
  assert.equal(split.regular.length, 2);
  assert.equal(split.sessionClose, 501);
  assert.ok(split.extended.length >= 2);
});

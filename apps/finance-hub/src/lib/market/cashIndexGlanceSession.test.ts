import assert from "node:assert/strict";
import test from "node:test";

import {
  cashIndexSegmentLabel,
  isTokyoCashSessionOpen,
  splitTimedPointsForCashIndexGlance,
  tokyoBarPhase,
  tokyoGlanceChartContext,
  tokyoYmd,
} from "@/lib/market/cashIndexGlanceSession";

test("tokyoBarPhase marks TSE morning and afternoon as regular", () => {
  const ymd = "2026-05-26";
  const morning = new Date("2026-05-26T00:30:00Z").getTime();
  const afternoon = new Date("2026-05-26T04:30:00Z").getTime();
  assert.equal(tokyoYmd(morning), ymd);
  assert.equal(tokyoBarPhase(morning, ymd), "regular");
  assert.equal(tokyoBarPhase(afternoon, ymd), "regular");
});

test("tokyoBarPhase marks after-hours on same Tokyo day", () => {
  const ymd = "2026-05-26";
  const after = new Date("2026-05-26T07:00:00Z").getTime();
  assert.equal(tokyoBarPhase(after, ymd), "post");
});

test("splitTimedPointsForCashIndexGlance separates Tokyo session and after hours", () => {
  const ymd = "2026-05-26";
  const rth1 = new Date("2026-05-26T00:30:00Z").getTime();
  const rth2 = new Date("2026-05-26T04:30:00Z").getTime();
  const post = new Date("2026-05-26T07:00:00Z").getTime();
  const ctx = {
    sessionYmd: ymd,
    chartYmd: ymd,
    extendedPhase: "post" as const,
    showExtended: true,
  };
  const split = splitTimedPointsForCashIndexGlance(
    [
      { tsMs: rth1, close: 38000 },
      { tsMs: rth2, close: 38100 },
      { tsMs: post, close: 38150 },
    ],
    ctx,
  );
  assert.equal(split.regular.length, 2);
  assert.ok(split.extended.length >= 2);
  assert.equal(split.last, 38150);
});

test("cashIndexSegmentLabel identifies cash index segments", () => {
  assert.equal(cashIndexSegmentLabel("regular"), "Tokyo session");
  assert.equal(cashIndexSegmentLabel("regular", null, "london"), "London session");
  assert.equal(cashIndexSegmentLabel("extended", "post"), "After hours");
});

test("isTokyoCashSessionOpen during TSE hours", () => {
  const open = new Date("2026-05-26T01:00:00Z");
  assert.equal(isTokyoCashSessionOpen(open), true);
  const ctx = tokyoGlanceChartContext(open);
  assert.equal(ctx.showExtended, false);
});

import assert from "node:assert/strict";
import test from "node:test";

import { glanceChartContext } from "@/lib/market/glanceExtendedHours";
import { filterExtendedRawForGrid, filterTimedPointsForGlanceSession } from "@/lib/market/glanceTimedFilters";

test("filterTimedPointsForGlanceSession includes today pre bars during pre-market", () => {
  const preMorning = new Date("2026-05-22T12:00:00.000Z"); // 08:00 ET
  const ctx = glanceChartContext(preMorning);
  assert.equal(ctx.extendedPhase, "pre");
  const priorRth = new Date("2026-05-21T18:00:00.000Z").getTime();
  const todayPre = new Date("2026-05-22T12:30:00.000Z").getTime();
  const out = filterTimedPointsForGlanceSession(
    [
      { tsMs: priorRth, close: 100 },
      { tsMs: todayPre, close: 101 },
    ],
    ctx.sessionYmd,
    ctx,
  );
  assert.equal(out.length, 2);
});

test("filterExtendedRawForGrid keeps pre-market bars after prior RTH close", () => {
  const regular = [{ tsMs: 1000, close: 100 }];
  const extended = [
    { tsMs: 900, close: 99 },
    { tsMs: 2000, close: 101 },
  ];
  const out = filterExtendedRawForGrid(extended, regular, "pre");
  assert.deepEqual(out, [{ tsMs: 2000, close: 101 }]);
});

test("filterExtendedRawForGrid drops overnight dead-zone bars", () => {
  const sessionYmd = "2026-05-22";
  const regular = [{ tsMs: new Date(`${sessionYmd}T16:00:00-04:00`).getTime(), close: 100 }];
  const deadZone = new Date(`${sessionYmd}T22:00:00-04:00`).getTime();
  const postMarket = new Date(`${sessionYmd}T17:30:00-04:00`).getTime();
  const out = filterExtendedRawForGrid(
    [
      { tsMs: deadZone, close: 99 },
      { tsMs: postMarket, close: 101 },
    ],
    regular,
    "post",
  );
  assert.equal(out.length, 1);
  assert.equal(out[0]!.tsMs, postMarket);
});

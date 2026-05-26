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

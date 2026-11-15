import assert from "node:assert/strict";
import test from "node:test";

import {
  PERFORMANCE_CHART_MARKERS,
  placePerformanceMarkers,
  referenceLineXForDate,
} from "@/lib/charts/performanceMarkers";

const noonUtc = (year: number, month: number, day: number) => Date.UTC(year, month - 1, day, 12);

test("BMNR exit marker is the Nov 5 2026 liquidation", () => {
  assert.deepEqual(PERFORMANCE_CHART_MARKERS, [{ date: "2026-11-05", label: "BMNR exit · Nov 5" }]);
});

test("categorical string axis uses the exact day when it is a point", () => {
  assert.deepEqual(
    referenceLineXForDate("2026-11-05", [{ x: "2026-11-04" }, { x: "2026-11-05" }, { x: "2026-11-06" }]),
    { x: "2026-11-05", axisDate: "2026-11-05" },
  );
});

test("categorical string axis snaps to the next point on or after a missing day", () => {
  assert.deepEqual(referenceLineXForDate("2026-11-05", [{ x: "2026-11-04" }, { x: "2026-11-06" }]), {
    x: "2026-11-06",
    axisDate: "2026-11-06",
  });
  assert.deepEqual(
    referenceLineXForDate("2026-11-05", [
      { x: "Nov 4", date: "2026-11-04" },
      { x: "Nov 6", date: "2026-11-06" },
    ]),
    { x: "Nov 6", axisDate: "2026-11-06" },
  );
});

test("timestamp axis maps the day to that point's epoch, in ms or seconds", () => {
  const nov4 = noonUtc(2026, 11, 4);
  const nov5 = noonUtc(2026, 11, 5);
  const nov6 = noonUtc(2026, 11, 6);
  assert.deepEqual(referenceLineXForDate("2026-11-05", [{ x: nov4 }, { x: nov5 }, { x: nov6 }]), {
    x: nov5,
    axisDate: "2026-11-05",
  });
  assert.deepEqual(
    referenceLineXForDate("2026-11-05", [
      { x: Math.floor(nov4 / 1000) },
      { x: Math.floor(nov6 / 1000) },
    ]),
    { x: Math.floor(nov6 / 1000), axisDate: "2026-11-06" },
  );
});

test("sequence-index axis uses the index of the snapped trading day", () => {
  const points = [
    { x: 0, date: "2026-11-04" },
    { x: 1, date: "2026-11-05" },
    { x: 2, date: "2026-11-06" },
  ];
  assert.deepEqual(referenceLineXForDate("2026-11-05", points), { x: 1, axisDate: "2026-11-05" });
  assert.deepEqual(
    referenceLineXForDate("2026-11-07", [
      { x: 3, date: "2026-11-06" },
      { x: 4, date: "2026-11-09" },
    ]),
    { x: 4, axisDate: "2026-11-09" },
  );
});

test("a bare sequence index is not read as a timestamp", () => {
  assert.equal(referenceLineXForDate("2026-11-05", [{ x: 0 }, { x: 1 }, { x: 2 }]), null);
});

test("the marker is hidden when its day is outside the visible span", () => {
  const points = [{ x: "2026-11-06" }, { x: "2026-11-10" }];
  assert.equal(referenceLineXForDate("2026-11-05", points), null);
  assert.equal(referenceLineXForDate("2026-11-12", points), null);
  assert.deepEqual(referenceLineXForDate("2026-11-06", points), { x: "2026-11-06", axisDate: "2026-11-06" });
  assert.deepEqual(referenceLineXForDate("2026-11-07", points), { x: "2026-11-10", axisDate: "2026-11-10" });
  assert.equal(referenceLineXForDate("2026-11-05", []), null);
  assert.equal(referenceLineXForDate("not-a-day", [{ x: "2026-11-05" }]), null);
});

test("unsorted points and same-day timestamps still snap to the earliest on-or-after point", () => {
  assert.deepEqual(
    referenceLineXForDate("2026-11-05", [{ x: "2026-11-09" }, { x: "2026-11-04" }, { x: "2026-11-06" }]),
    { x: "2026-11-06", axisDate: "2026-11-06" },
  );
  const morning = Date.UTC(2026, 10, 5, 14, 30);
  const afternoon = Date.UTC(2026, 10, 5, 17, 28);
  assert.equal(
    referenceLineXForDate("2026-11-05", [{ x: afternoon }, { x: morning }, { x: Date.UTC(2026, 10, 6, 15) }])?.x,
    morning,
  );
});

test("an ISO timestamp string uses its calendar-day prefix", () => {
  assert.deepEqual(referenceLineXForDate("2026-11-05T17:28:00-05:00", [{ x: "2026-11-05T16:00:00Z" }]), {
    x: "2026-11-05T16:00:00Z",
    axisDate: "2026-11-05",
  });
});

test("only markers inside the chart span are placed", () => {
  const points = [
    { x: 10, date: "2026-11-04" },
    { x: 11, date: "2026-11-05" },
    { x: 12, date: "2026-11-06" },
  ];
  assert.deepEqual(
    placePerformanceMarkers(
      [
        { date: "2026-10-01", label: "before" },
        { date: "2026-11-05", label: "BMNR exit · Nov 5" },
        { date: "2026-12-01", label: "after" },
      ],
      points,
    ),
    [{ date: "2026-11-05", label: "BMNR exit · Nov 5", x: 11, axisDate: "2026-11-05" }],
  );
  assert.deepEqual(placePerformanceMarkers(PERFORMANCE_CHART_MARKERS, points), [
    { date: "2026-11-05", label: "BMNR exit · Nov 5", x: 11, axisDate: "2026-11-05" },
  ]);
  assert.deepEqual(
    placePerformanceMarkers(PERFORMANCE_CHART_MARKERS, [
      { x: 0, date: "2026-11-06" },
      { x: 1, date: "2026-11-09" },
    ]),
    [],
  );
});

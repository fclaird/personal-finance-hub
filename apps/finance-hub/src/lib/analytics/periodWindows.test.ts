import assert from "node:assert/strict";
import test from "node:test";

import {
  isNyTradingDayYmd,
  mondayWeekStartYmd,
  priorTradingDayYmd,
  resolvePeriodWindow,
  sundayOfWeekYmd,
} from "@/lib/analytics/periodWindows";

test("isNyTradingDayYmd rejects weekends and NYSE holidays", () => {
  assert.equal(isNyTradingDayYmd("2026-08-31"), true);
  assert.equal(isNyTradingDayYmd("2026-08-30"), false);
  assert.equal(isNyTradingDayYmd("2026-07-04"), false);
});

test("priorTradingDayYmd skips weekend from Monday", () => {
  assert.equal(priorTradingDayYmd("2026-09-01"), "2026-08-31");
});

test("resolvePeriodWindow daily uses glance session and prior close anchor", () => {
  const now = new Date("2026-08-31T15:00:00-04:00");
  const w = resolvePeriodWindow("daily", now);
  assert.equal(w.startYmd, "2026-08-31");
  assert.equal(w.endYmd, "2026-08-31");
  assert.equal(w.startAnchorYmd, "2026-08-28");
});

test("resolvePeriodWindow weekly is Monday through today in NY", () => {
  const now = new Date("2026-08-31T15:00:00-04:00");
  const w = resolvePeriodWindow("weekly", now);
  assert.equal(w.startYmd, "2026-08-31");
  assert.equal(w.endYmd, "2026-08-31");
  assert.equal(w.startAnchorYmd, "2026-08-28");
});

test("resolvePeriodWindow monthly starts on first of NY month", () => {
  const now = new Date("2026-08-31T15:00:00-04:00");
  const w = resolvePeriodWindow("monthly", now);
  assert.equal(w.startYmd, "2026-08-01");
  assert.equal(w.endYmd, "2026-08-31");
  assert.equal(w.startAnchorYmd, "2026-07-31");
});

test("resolvePeriodWindow ytd starts Jan 1 NY", () => {
  const now = new Date("2026-08-31T15:00:00-04:00");
  const w = resolvePeriodWindow("ytd", now);
  assert.equal(w.startYmd, "2026-01-01");
  assert.equal(w.endYmd, "2026-08-31");
  assert.equal(w.startAnchorYmd, "2025-12-31");
});


test("mondayWeekStartYmd returns Monday for midweek and weekend dates", () => {
  assert.equal(mondayWeekStartYmd("2026-09-03"), "2026-08-31"); // Thu
  assert.equal(mondayWeekStartYmd("2026-08-31"), "2026-08-31"); // Mon
  assert.equal(mondayWeekStartYmd("2026-09-06"), "2026-08-31"); // Sun
});

test("sundayOfWeekYmd is six days after Monday", () => {
  assert.equal(sundayOfWeekYmd("2026-08-31"), "2026-09-06");
});

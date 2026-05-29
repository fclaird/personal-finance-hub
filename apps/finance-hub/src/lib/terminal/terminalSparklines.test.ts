import assert from "node:assert/strict";
import test from "node:test";

import {
  closesForSessionDay,
  nyYmdForTs,
  sparklineSessionYmd,
} from "@/lib/terminal/terminalSparklines";

test("sparklineSessionYmd prefers today when candles exist for today", () => {
  const now = new Date("2026-05-29T18:00:00-04:00");
  const candles = [
    { tsMs: new Date("2026-05-28T15:00:00-04:00").getTime(), close: 100 },
    { tsMs: new Date("2026-05-29T10:00:00-04:00").getTime(), close: 101 },
  ];
  assert.equal(sparklineSessionYmd(candles, now), "2026-05-29");
});

test("sparklineSessionYmd falls back to latest day when today is empty", () => {
  const now = new Date("2026-05-29T18:00:00-04:00");
  const candles = [{ tsMs: new Date("2026-05-28T15:00:00-04:00").getTime(), close: 100 }];
  assert.equal(sparklineSessionYmd(candles, now), "2026-05-28");
});

test("closesForSessionDay keeps only the chosen session day", () => {
  const now = new Date("2026-05-29T18:00:00-04:00");
  const candles = [
    { tsMs: new Date("2026-05-28T15:00:00-04:00").getTime(), open: 1, high: 1, low: 1, close: 99, volume: 1 },
    { tsMs: new Date("2026-05-29T10:00:00-04:00").getTime(), open: 1, high: 1, low: 1, close: 100, volume: 1 },
    { tsMs: new Date("2026-05-29T11:00:00-04:00").getTime(), open: 1, high: 1, low: 1, close: 101, volume: 1 },
  ];
  assert.deepEqual(closesForSessionDay(candles, now), [100, 101]);
});

test("nyYmdForTs uses America/New_York", () => {
  assert.equal(nyYmdForTs(new Date("2026-05-29T03:30:00-04:00").getTime()), "2026-05-29");
});

import assert from "node:assert/strict";
import test from "node:test";

import { addUtcDays, iterateUtcDatesInclusive, isoDateUtc } from "./dates";

test("isoDateUtc returns UTC calendar date", () => {
  assert.equal(isoDateUtc(new Date("2026-05-22T23:00:00Z")), "2026-05-22");
});

test("iterateUtcDatesInclusive spans calendar days", () => {
  assert.deepEqual(iterateUtcDatesInclusive("2026-05-20", "2026-05-22"), [
    "2026-05-20",
    "2026-05-21",
    "2026-05-22",
  ]);
});

test("addUtcDays advances one day", () => {
  assert.equal(addUtcDays("2026-05-22", 1), "2026-05-23");
});

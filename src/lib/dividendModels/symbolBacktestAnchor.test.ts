import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { anchorMonthEndForWindowYears } from "./symbolBacktestAnchor";
import { parseTrackingMode } from "./types";

describe("anchorMonthEndForWindowYears", () => {
  it("returns month-end for 5y window start", () => {
    const me = anchorMonthEndForWindowYears(new Date("2026-05-15T12:00:00Z"), 5);
    assert.match(me, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(me >= "2021-05-01");
  });
});

describe("parseTrackingMode", () => {
  it("defaults to backtest", () => {
    assert.equal(parseTrackingMode(null), "backtest");
    assert.equal(parseTrackingMode("live"), "live");
  });
});

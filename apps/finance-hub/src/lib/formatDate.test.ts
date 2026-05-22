import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  formatDisplayDate,
  formatDisplayMonth,
  formatModeledChartMonthEndLabel,
  formatPeriodEndingLabel,
} from "./formatDate";

describe("formatDisplayDate", () => {
  it("formats ISO calendar dates", () => {
    assert.equal(formatDisplayDate("2026-02-28"), "Feb 28, 2026");
  });

  it("formats month keys", () => {
    assert.equal(formatDisplayMonth("2026-02"), "Feb 2026");
    assert.equal(formatDisplayMonth("2026-02-28"), "Feb 2026");
  });
});

describe("formatPeriodEndingLabel", () => {
  it("uses readable month ending copy", () => {
    assert.equal(formatPeriodEndingLabel("2026-02-28", false), "Month ending Feb 28, 2026");
  });
});

describe("formatModeledChartMonthEndLabel", () => {
  it("shows quarter labels on 5y window", () => {
    assert.equal(formatModeledChartMonthEndLabel("2026-03-31", 5, false), "Q1 '26");
  });
});

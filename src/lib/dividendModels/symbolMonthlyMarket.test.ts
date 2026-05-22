import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { bucketDividendsByMonthEnd, computeTtmYieldPct } from "./symbolMonthlyMarket";

describe("bucketDividendsByMonthEnd", () => {
  it("sums payments into pay-month month_end keys", () => {
    const m = bucketDividendsByMonthEnd([
      { payDateIso: "2024-03-15", amount: 0.5 },
      { payDateIso: "2024-03-28", amount: 0.25 },
      { payDateIso: "2024-04-10", amount: 0.5 },
    ]);
    assert.equal(m.get("2024-03-31"), 0.75);
    assert.equal(m.get("2024-04-30"), 0.5);
  });
});

describe("computeTtmYieldPct", () => {
  it("returns trailing 12m dividend sum / close as percent", () => {
    const months = ["2023-01-31", "2023-02-28", "2023-03-31"];
    const div = new Map<string, number>([
      ["2023-01-31", 0.25],
      ["2023-02-28", 0.25],
      ["2023-03-31", 0.25],
    ]);
    const close = new Map<string, number | null>([
      ["2023-01-31", 100],
      ["2023-02-28", 100],
      ["2023-03-31", 50],
    ]);
    const yld = computeTtmYieldPct(months, div, close, "2023-03-31");
    assert.equal(yld, ((0.75) / 50) * 100);
  });

  it("returns null when close is missing or zero", () => {
    const months = ["2023-03-31"];
    const div = new Map<string, number>([["2023-03-31", 1]]);
    const close = new Map<string, number | null>([["2023-03-31", null]]);
    assert.equal(computeTtmYieldPct(months, div, close, "2023-03-31"), null);
  });
});

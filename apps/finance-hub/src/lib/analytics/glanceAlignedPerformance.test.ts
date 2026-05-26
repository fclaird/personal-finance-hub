import assert from "node:assert/strict";
import test from "node:test";

import {
  mergeGlanceAlignedDailyTotals,
  resolvePerformanceTrackingBaselineYmd,
} from "@/lib/analytics/glanceAlignedPerformance";

test("mergeGlanceAlignedDailyTotals sums Schwab liquidation and external MV per day", () => {
  const merged = mergeGlanceAlignedDailyTotals(
    [{ asOf: "2026-05-22T15:00:00Z", totalMarketValue: 5_000_000 }],
    [{ asOf: "2026-05-22T16:00:00Z", totalMarketValue: 250_000 }],
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0]!.totalMarketValue, 5_250_000);
});

test("resolvePerformanceTrackingBaselineYmd uses lookback when enough history exists", () => {
  const series = [
    { asOf: "2026-05-05T12:00:00Z", totalMarketValue: 1 },
    { asOf: "2026-05-06T12:00:00Z", totalMarketValue: 2 },
    { asOf: "2026-05-22T12:00:00Z", totalMarketValue: 3 },
  ];
  const out = resolvePerformanceTrackingBaselineYmd(series, new Date("2026-05-22T18:00:00-04:00"));
  assert.equal(out.baselineYmd, "2026-05-05");
  assert.equal(out.resetForward, false);
});

test("resolvePerformanceTrackingBaselineYmd resets forward when history is too thin", () => {
  const series = [{ asOf: "2026-05-22T12:00:00Z", totalMarketValue: 1 }];
  const out = resolvePerformanceTrackingBaselineYmd(series, new Date("2026-05-22T18:00:00-04:00"));
  assert.equal(out.baselineYmd, "2026-05-22");
  assert.equal(out.resetForward, true);
});

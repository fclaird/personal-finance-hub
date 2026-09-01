import assert from "node:assert/strict";
import test from "node:test";

import {
  mergeGlanceAlignedDailyTotals,
  mergeMissingSnapshotDays,
  resolvePerformanceTrackingBaselineYmd,
} from "@/lib/analytics/glanceAlignedPerformance";

test("mergeMissingSnapshotDays fills days that liquidation series skipped", () => {
  const merged = mergeMissingSnapshotDays(
    [
      { asOf: "2026-06-23T20:00:00.000Z", totalMarketValue: 100 },
      { asOf: "2026-07-10T20:00:00.000Z", totalMarketValue: 120 },
    ],
    [
      { snapshot_date: "2026-06-23", total_value: 99 },
      { snapshot_date: "2026-07-03", total_value: 110 },
    ],
  );
  assert.equal(merged.length, 3);
  assert.equal(merged[1]!.asOf.startsWith("2026-07-03"), true);
  assert.equal(merged[1]!.totalMarketValue, 110);
});

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

test("resolvePerformanceTrackingBaselineYmd does not cap all-history at the recency window", () => {
  const series = [
    { asOf: "2026-01-05T12:00:00Z", totalMarketValue: 1 },
    { asOf: "2026-01-06T12:00:00Z", totalMarketValue: 2 },
    { asOf: "2026-05-21T12:00:00Z", totalMarketValue: 3 },
    { asOf: "2026-05-22T12:00:00Z", totalMarketValue: 4 },
  ];
  const out = resolvePerformanceTrackingBaselineYmd(series, new Date("2026-05-22T18:00:00-04:00"));
  assert.equal(out.baselineYmd, "2026-01-05");
  assert.equal(out.resetForward, false);
});

test("resolvePerformanceTrackingBaselineYmd resets forward when history is too thin", () => {
  const series = [{ asOf: "2026-05-22T12:00:00Z", totalMarketValue: 1 }];
  const out = resolvePerformanceTrackingBaselineYmd(series, new Date("2026-05-22T18:00:00-04:00"));
  assert.equal(out.baselineYmd, "2026-05-22");
  assert.equal(out.resetForward, true);
});

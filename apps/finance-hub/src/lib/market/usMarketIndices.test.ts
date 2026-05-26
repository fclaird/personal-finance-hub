import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeSeriesForChart, resolveSchwabAnchoredDayMetrics } from "./usMarketIndices";

describe("normalizeSeriesForChart", () => {
  it("does not prepend prior close when session opens with a gap", () => {
    const series = [
      { idx: 0, close: 510 },
      { idx: 1, close: 512 },
      { idx: 2, close: 511 },
    ];
    const out = normalizeSeriesForChart(series, 500, 511);
    assert.equal(out[0]?.close, 510);
    assert.equal(out.length, 3);
  });

  it("keeps prior close anchor when there is no intraday data", () => {
    const out = normalizeSeriesForChart([], 500, 510);
    assert.equal(out.length, 2);
    assert.equal(out[0]?.close, 500);
    assert.equal(out[1]?.close, 510);
  });

  it("anchors a single intraday bar at open, not prior close", () => {
    const out = normalizeSeriesForChart([{ idx: 0, close: 510 }], 500, 512);
    assert.equal(out.length, 2);
    assert.equal(out[0]?.close, 510);
    assert.equal(out[1]?.close, 512);
  });

  it("appends live last when it differs from the final bar", () => {
    const series = [
      { idx: 0, close: 510 },
      { idx: 1, close: 511 },
    ];
    const out = normalizeSeriesForChart(series, 500, 513);
    assert.equal(out[out.length - 1]?.close, 513);
  });
});

describe("resolveSchwabAnchoredDayMetrics", () => {
  it("prefers Schwab prior close and net percent over mismatched Yahoo fallback", () => {
    const out = resolveSchwabAnchoredDayMetrics(
      {
        last: 509.2,
        change: 9.2,
        changePercent: 0.0184,
        previousClose: 500,
      },
      509.2,
      491,
    );
    assert.equal(out.previousClose, 500);
    assert.ok(out.changePct != null && Math.abs(out.changePct - 1.84) < 1e-9);
  });

  it("falls back to price math when Schwab percent is unavailable", () => {
    const out = resolveSchwabAnchoredDayMetrics(
      {
        last: 504.25,
        change: 4.25,
        changePercent: null,
        previousClose: 500,
      },
      504.25,
      500,
    );
    assert.ok(out.changePct != null && Math.abs(out.changePct - 0.85) < 1e-9);
  });
});

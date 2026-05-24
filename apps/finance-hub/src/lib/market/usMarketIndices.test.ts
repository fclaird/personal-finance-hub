import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeSeriesForChart } from "./usMarketIndices";

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
    assert.deepEqual(out, [
      { idx: 0, close: 500 },
      { idx: 1, close: 510 },
    ]);
  });

  it("anchors a single intraday bar at open, not prior close", () => {
    const out = normalizeSeriesForChart([{ idx: 0, close: 510 }], 500, 512);
    assert.deepEqual(out, [
      { idx: 0, close: 510 },
      { idx: 1, close: 512 },
    ]);
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

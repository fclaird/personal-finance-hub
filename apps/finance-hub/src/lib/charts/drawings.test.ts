import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_INDICATORS, sanitizeIndicatorSettings } from "@/lib/charts/indicatorSettings";
import { distToSegment, fibPrices, hexToRgba, parallelEnd, parseDrawingDocument, snapToOhlc } from "@/lib/charts/drawings";

describe("drawing geometry", () => {
  it("computes fib prices from the two anchors", () => {
    const levels = fibPrices(100, 80);
    assert.equal(levels.find((level) => level.ratio === 0.5)!.price, 90);
    // 100 + (80-100) * 0.618 = 87.64
    assert.ok(Math.abs(levels.find((level) => level.ratio === 0.618)!.price - 87.64) < 1e-9);
  });

  it("offsets the parallel endpoint by the base segment", () => {
    const end = parallelEnd({ time: 0, price: 10 }, { time: 4, price: 14 }, { time: 0, price: 12 });
    assert.equal(end.dTime, 4);
    assert.equal(end.dPrice, 16);
  });

  it("snaps to the nearest OHLC within the pixel threshold", () => {
    const snapped = snapToOhlc(10.2, { open: 9, high: 12, low: 8, close: 10 }, (price) => -price, 1);
    assert.equal(snapped, 10);
    const far = snapToOhlc(10.2, { open: 9, high: 12, low: 8, close: 10 }, (price) => -price, 0.1);
    assert.equal(far, 10.2);
  });

  it("measures distance to a segment", () => {
    assert.equal(distToSegment(0, 1, 0, 0, 10, 0), 1);
  });

  it("rejects a drawing document with a bad color", () => {
    assert.equal(
      parseDrawingDocument({
        version: 1,
        locked: false,
        hidden: false,
        drawings: [
          {
            id: "a",
            type: "hline",
            a: { time: "2024-01-02", price: 10 },
            color: "red",
            width: 2,
            dash: "solid",
          },
        ],
      }),
      null,
    );
    const ok = parseDrawingDocument({
      version: 1,
      locked: true,
      hidden: false,
      drawings: [
        {
          id: "a",
          type: "trend",
          a: { time: "2024-01-02", price: 10 },
          b: { time: "2024-01-05", price: 12 },
          color: "#E4E4E7",
          width: 2,
          dash: "dashed",
        },
      ],
    });
    assert.equal(ok?.locked, true);
    assert.equal(ok?.drawings.length, 1);
  });
});

describe("indicator defaults", () => {
  it("shows the moving-average ribbon and Ichimoku, and hides the rest", () => {
    assert.equal(DEFAULT_INDICATORS.ma.every((ma) => ma.visible), true);
    assert.deepEqual(
      DEFAULT_INDICATORS.ma.map((ma) => ma.period),
      [20, 50, 100, 200],
    );
    assert.equal(DEFAULT_INDICATORS.ichimoku.visible, true);
    assert.equal(DEFAULT_INDICATORS.ichimoku.displacement, 26);
    assert.equal(DEFAULT_INDICATORS.bb.visible, false);
    assert.equal(DEFAULT_INDICATORS.bmsb.visible, false);
    assert.equal(DEFAULT_INDICATORS.vwap.visible, false);
    assert.equal(DEFAULT_INDICATORS.volume.visible, false);
    assert.equal(DEFAULT_INDICATORS.profile.visible, false);
  });

  it("keeps a saved Bollinger toggle and falls back when a period is garbage", () => {
    const next = sanitizeIndicatorSettings({ bb: { visible: true, period: "nope" }, ma: [{ period: 21 }] });
    assert.equal(next.bb.visible, true);
    assert.equal(next.bb.period, DEFAULT_INDICATORS.bb.period);
    assert.equal(next.ma[0]!.period, 21);
    assert.equal(next.ma[1]!.period, 50);
    assert.equal(next.vwap.visible, false);
  });
});

describe("hex colors", () => {
  it("adds an alpha channel", () => {
    assert.equal(hexToRgba("#089981", 0.28), "rgba(8, 153, 129, 0.28)");
  });
});

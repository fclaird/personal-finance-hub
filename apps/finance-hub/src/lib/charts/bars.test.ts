import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { addBusinessDays, aggregateCandles, futureTimes, nextRegularBar, sessionDate, zonedUtcSeconds } from "@/lib/charts/bars";
import { DEFAULT_INDICATORS } from "@/lib/charts/indicatorSettings";
import { buildChartModel } from "@/lib/charts/model";
import type { ChartCandle } from "@/lib/charts/types";
import { volumeProfile } from "@/lib/charts/volumeProfile";

describe("session dates and future bars", () => {
  it("reads a New York session date from a UTC timestamp", () => {
    const ts = Date.UTC(2024, 0, 2, 14, 30) / 1000;
    assert.equal(sessionDate(ts), "2024-01-02");
    const late = Date.UTC(2024, 0, 3, 1, 0) / 1000;
    assert.equal(sessionDate(late), "2024-01-02");
  });

  it("steps Friday forward to Monday", () => {
    assert.equal(addBusinessDays("2024-01-05", 1), "2024-01-08");
    assert.deepEqual(futureTimes("2024-01-05", "1d", 2), ["2024-01-08", "2024-01-09"]);
  });

  it("places the next 5-minute bar on Monday's open after Friday's close", () => {
    const friday1555 = Date.UTC(2024, 0, 5, 20, 55) / 1000;
    const mondayOpen = Date.UTC(2024, 0, 8, 14, 30) / 1000;
    assert.equal(nextRegularBar(friday1555, 5), mondayOpen);
    assert.equal(zonedUtcSeconds(2024, 7, 8, 9, 30), Date.UTC(2024, 6, 8, 13, 30) / 1000);
  });
});

describe("aggregate candles", () => {
  it("rolls two daily bars into the Monday week", () => {
    const bars: ChartCandle[] = [
      { time: "2024-01-01", open: 1, high: 5, low: 0.5, close: 4, volume: 10 },
      { time: "2024-01-02", open: 4, high: 6, low: 3, close: 5, volume: 7 },
      { time: "2024-01-08", open: 5, high: 8, low: 4, close: 7, volume: 3 },
    ];
    const weekly = aggregateCandles(bars, "1wk");
    assert.equal(weekly.length, 2);
    assert.equal(weekly[0]!.time, "2024-01-01");
    assert.equal(weekly[0]!.open, 1);
    assert.equal(weekly[0]!.high, 6);
    assert.equal(weekly[0]!.low, 0.5);
    assert.equal(weekly[0]!.close, 5);
    assert.equal(weekly[0]!.volume, 17);
    assert.equal(weekly[1]!.time, "2024-01-08");
    assert.equal(weekly[1]!.close, 7);
  });
});

describe("volume profile", () => {
  it("splits an up bar evenly across two bins", () => {
    const bins = volumeProfile([{ open: 1, high: 10, low: 0, close: 9, volume: 100 }], 2);
    assert.equal(bins.length, 2);
    assert.ok(Math.abs(bins[0]!.up - 50) < 1e-9);
    assert.ok(Math.abs(bins[1]!.up - 50) < 1e-9);
    assert.equal(bins[0]!.down, 0);
  });

  it("keeps a down bar that stops at the first bin out of the second", () => {
    const bins = volumeProfile(
      [
        { open: 5, high: 2.5, low: 0, close: 1, volume: 100 },
        { open: 1, high: 5, low: 4, close: 4.5, volume: 0 },
      ],
      2,
    );
    assert.ok(Math.abs(bins[0]!.down - 100) < 1e-9);
    assert.equal(bins[1]!.down, 0);
    assert.equal(bins[0]!.up, 0);
  });
});

describe("chart model displacement", () => {
  it("plots span A on the bar 26 sessions ahead", () => {
    const candles: ChartCandle[] = Array.from({ length: 60 }, (_, i) => {
      const day = addBusinessDays("2024-01-02", i);
      return { time: day, open: 10, high: 12 + (i % 3), low: 8, close: 11, volume: 1000 };
    });
    const model = buildChartModel(candles, "1d", DEFAULT_INDICATORS, null);
    assert.equal(model.times.length, candles.length + 26);
    assert.equal(model.times[60 + 25], futureTimes(String(candles[59]!.time), "1d", 26)[25]);
    const source = 30;
    const plotted = model.spanA.find((point) => point.time === candles[source + 26]!.time);
    assert.ok(plotted);
    assert.equal(plotted!.value, model.valuesAt(source).leadingA);
  });
});

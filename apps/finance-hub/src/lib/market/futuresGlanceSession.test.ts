import assert from "node:assert/strict";
import test from "node:test";

import {
  cmeEquityIndexFuturesPhase,
  cmeFuturesSessionStartMs,
  futuresGlanceKindForInstrument,
  isCmeEquityIndexFuturesTradable,
  isFuturesInstrumentTradable,
  splitTimedPointsForFuturesGlance,
} from "@/lib/market/futuresGlanceSession";
import { REGIONAL_MARKET_INSTRUMENTS } from "@/lib/market/regionalMarketInstruments";

test("cmeEquityIndexFuturesPhase follows Globex schedule", () => {
  const sunOpen = new Date("2026-05-24T18:30:00-04:00");
  const sunEarly = new Date("2026-05-24T12:00:00-04:00");
  const tueOvernight = new Date("2026-05-26T03:00:00-04:00");
  const tueMaint = new Date("2026-05-26T17:30:00-04:00");
  const sat = new Date("2026-05-23T12:00:00-04:00");
  const friAfterClose = new Date("2026-05-22T17:30:00-04:00");

  assert.equal(cmeEquityIndexFuturesPhase(sunEarly.getTime()), "closed");
  assert.equal(cmeEquityIndexFuturesPhase(sunOpen.getTime()), "tradable");
  assert.equal(cmeEquityIndexFuturesPhase(tueOvernight.getTime()), "tradable");
  assert.equal(cmeEquityIndexFuturesPhase(tueMaint.getTime()), "maintenance");
  assert.equal(cmeEquityIndexFuturesPhase(sat.getTime()), "closed");
  assert.equal(cmeEquityIndexFuturesPhase(friAfterClose.getTime()), "closed");
});

test("isCmeEquityIndexFuturesTradable during overnight Globex", () => {
  const tueOvernight = new Date("2026-05-26T03:00:00-04:00");
  assert.equal(isCmeEquityIndexFuturesTradable(tueOvernight), true);
});

test("futuresGlanceKindForInstrument classifies ES as CME", () => {
  const es = REGIONAL_MARKET_INSTRUMENTS.find((d) => d.id === "us-es")!;
  assert.equal(futuresGlanceKindForInstrument(es), "cme_equity_index");
  assert.equal(isFuturesInstrumentTradable("cme_equity_index", "us", new Date("2026-05-26T03:00:00-04:00")), true);
});

test("splitTimedPointsForFuturesGlance puts Globex bars in regular series", () => {
  const now = new Date("2026-05-26T03:00:00-04:00");
  const sessionStart = cmeFuturesSessionStartMs(now);
  const points = [
    { tsMs: sessionStart + 5 * 60 * 1000, close: 5900 },
    { tsMs: sessionStart + 65 * 60 * 1000, close: 5905 },
    { tsMs: now.getTime(), close: 5910 },
  ];
  const split = splitTimedPointsForFuturesGlance(points, "cme_equity_index", "us", now);
  assert.equal(split.regular.length, 3);
  assert.equal(split.extended.length, 0);
  assert.equal(split.last, 5910);
});

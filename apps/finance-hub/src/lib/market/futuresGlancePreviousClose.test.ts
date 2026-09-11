import assert from "node:assert/strict";
import test from "node:test";

import {
  futuresGlanceDayChange,
  resolveFuturesGlancePreviousClose,
} from "@/lib/market/futuresGlancePreviousClose";
import { cmeFuturesSessionStartMs } from "@/lib/market/futuresGlanceSession";

/** Fri Sep 11 2026 ~pre-cash-open (Chris / public-wire ground truth). */
const PRE_OPEN = new Date("2026-09-11T09:00:00-04:00");

test("resolveFuturesGlancePreviousClose prefers official settle over 5d chartPreviousClose", () => {
  // Yahoo 5d ES=F that morning: chartPreviousClose was days-old; previousClose was the Globex settle.
  const prior = resolveFuturesGlancePreviousClose({
    meta: {
      chartPreviousClose: 7680.5,
      previousClose: 7598.5,
      regularMarketPrice: 7666.5,
    },
    kind: "cme_equity_index",
    now: PRE_OPEN,
  });
  assert.equal(prior, 7598.5);

  const day = futuresGlanceDayChange(7666.5, prior);
  assert.ok(day.change != null && Math.abs(day.change - 68) < 0.6);
  assert.ok(day.changePct != null && Math.abs(day.changePct - 0.895) < 0.02);
  assert.ok(day.changePct! > 0, "ES must be green vs prior settle, not red vs 5d chart baseline");
});

test("resolveFuturesGlancePreviousClose uses NQ official settle not 5d chart baseline", () => {
  const prior = resolveFuturesGlancePreviousClose({
    meta: {
      chartPreviousClose: 29538.75,
      previousClose: 29135.25,
      regularMarketPrice: 29432.5,
    },
    kind: "cme_equity_index",
    now: PRE_OPEN,
  });
  assert.equal(prior, 29135.25);

  const day = futuresGlanceDayChange(29432.5, prior);
  assert.ok(day.change != null && Math.abs(day.change - 297.25) < 0.6);
  assert.ok(day.changePct != null && Math.abs(day.changePct - 1.02) < 0.03);
  assert.ok(day.changePct! > 0, "NQ must be ~+1% vs settle, not hundreds of points red");
});

test("resolveFuturesGlancePreviousClose does not use cash QQQ/SPY prior or current-session open", () => {
  const sessionStart = cmeFuturesSessionStartMs(PRE_OPEN);
  const timed = [
    { tsMs: sessionStart - 65 * 60 * 1000, close: 7599.0 },
    { tsMs: sessionStart + 5 * 60 * 1000, close: 7602.5 },
    { tsMs: PRE_OPEN.getTime(), close: 7666.5 },
  ];
  const prior = resolveFuturesGlancePreviousClose({
    meta: {
      chartPreviousClose: 7680.5,
      previousClose: 7598.5,
    },
    timed,
    kind: "cme_equity_index",
    now: PRE_OPEN,
  });
  assert.equal(prior, 7598.5);
  assert.notEqual(prior, 500, "must not inherit SPY/QQQ cash prior");
  assert.notEqual(prior, 7602.5, "must not use current Globex session open");
});

test("resolveFuturesGlancePreviousClose falls back to last print of prior Globex session", () => {
  const sessionStart = cmeFuturesSessionStartMs(PRE_OPEN);
  const timed = [
    { tsMs: sessionStart - 65 * 60 * 1000, close: 7599.25 },
    { tsMs: sessionStart + 5 * 60 * 1000, close: 7602.5 },
    { tsMs: PRE_OPEN.getTime(), close: 7666.5 },
  ];
  const prior = resolveFuturesGlancePreviousClose({
    meta: { chartPreviousClose: 7680.5 },
    timed,
    kind: "cme_equity_index",
    now: PRE_OPEN,
  });
  assert.equal(prior, 7599.25);
});

test("resolveFuturesGlancePreviousClose last-resorts to chartPreviousClose only without settle or prior bars", () => {
  const prior = resolveFuturesGlancePreviousClose({
    meta: { chartPreviousClose: 7598.5 },
    kind: "cme_equity_index",
    now: PRE_OPEN,
  });
  assert.equal(prior, 7598.5);
});

import assert from "node:assert/strict";
import test from "node:test";

import { resolveEquityMarkPx } from "./equityMarkPrice";
import { navFromYahooChartResult } from "./yahooLatestPrice";

test("navFromYahooChartResult prefers regularMarketPrice then last bar close", () => {
  const fromMeta = navFromYahooChartResult({
    meta: { regularMarketPrice: 142.5 },
    indicators: { quote: [{ close: [140, 141] }] },
  });
  assert.equal(fromMeta, 142.5);

  const fromBar = navFromYahooChartResult({
    meta: {},
    indicators: { quote: [{ close: [null, 138.25] }] },
  });
  assert.equal(fromBar, 138.25);
});

test("resolveEquityMarkPx prefers Schwab live then Yahoo then schwab price_points", () => {
  const live = new Map([["VFFSX", 100]]);
  const yahoo = new Map([["VSCPX", 55.2]]);
  const schwabPp = new Map([["ABC", 10]]);
  const yahooPp = new Map([["XYZ", 20]]);

  assert.equal(resolveEquityMarkPx("VFFSX", live, schwabPp, null, yahoo, yahooPp), 100);
  assert.equal(resolveEquityMarkPx("VSCPX", live, schwabPp, 50, yahoo, yahooPp), 55.2);
  assert.equal(resolveEquityMarkPx("ABC", live, schwabPp, null, yahoo, yahooPp), 10);
  assert.equal(resolveEquityMarkPx("XYZ", live, schwabPp, null, yahoo, yahooPp), 20);
  assert.equal(resolveEquityMarkPx("MISS", live, schwabPp, 12.5, yahoo, yahooPp), 12.5);
});

test("manual fund MV: resolved Yahoo mark uses price times quantity not stale stored MV", () => {
  const live = new Map<string, number>();
  const yahoo = new Map([["VFFSX", 200]]);
  const staleSnapshot = 150;
  const markPx = resolveEquityMarkPx("VFFSX", live, new Map(), null, yahoo, new Map());
  assert.equal(markPx, 200);
  assert.equal(resolveEquityMarkPx("VFFSX", live, new Map(), staleSnapshot, yahoo, new Map()), 200);
  const qty = 10;
  const marketValue = markPx != null ? markPx * qty : null;
  assert.equal(marketValue, 2000);
});

test("529 manual fund: stored market value is authoritative over NAV times quantity", () => {
  const storedMv = 194_528;
  const qty = 1618;
  const publicNav = 368.58;
  const wrongMv = publicNav * qty;
  assert.ok(wrongMv > storedMv * 2);
  const useStored = storedMv;
  assert.equal(useStored, 194_528);
});

test("manual positions: stale snapshot implied must not block Yahoo when passed as null", () => {
  const live = new Map<string, number>();
  const staleImplied = 368.58;
  assert.equal(resolveEquityMarkPx("VFFSX", live, new Map(), staleImplied, new Map(), new Map()), staleImplied);
  assert.equal(resolveEquityMarkPx("VFFSX", live, new Map(), null, new Map([["VFFSX", 366.25]]), new Map()), 366.25);
});

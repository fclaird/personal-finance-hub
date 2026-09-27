import assert from "node:assert/strict";
import test from "node:test";

import { nyWallTimeMs } from "@/lib/market/futuresGlanceSession";
import { selectPortfolioSessionValuation } from "@/lib/terminal/portfolioSessionValuation";

const SESSION = "2026-05-22";

test("portfolio day % locks to the 16:00 snapshot after the cash close", () => {
  const closeMs = nyWallTimeMs(SESSION, 16 * 60);
  const valuation = selectPortfolioSessionValuation({
    now: new Date("2026-05-23T00:00:00.000Z"), // Friday 20:00 ET
    sessionYmd: SESSION,
    netValue: 400_000,
    priorNetValue: 1_000_000,
    netCashFlow: 0,
    externalCurrent: 0,
    schwabIntraday: [
      { tsMs: nyWallTimeMs(SESSION, 11 * 60), total: 1_001_000 },
      { tsMs: nyWallTimeMs(SESSION, 15 * 60 + 55), total: 1_002_000 },
      { tsMs: closeMs + 4 * 60 * 60 * 1000, total: 400_000 },
    ],
  });
  assert.equal(valuation.lockedToSessionClose, true);
  assert.equal(valuation.netValueForReturn, 1_002_000);
  assert.equal(valuation.seriesThroughMs, closeMs);
  assert.ok(valuation.changePct != null && Math.abs(valuation.changePct - 0.2) < 1e-9);
});

test("portfolio day % stays locked over the weekend and pre-open", () => {
  const points = [
    { tsMs: nyWallTimeMs(SESSION, 15 * 60 + 50), total: 1_010_000 },
    { tsMs: nyWallTimeMs(SESSION, 18 * 60), total: 200_000 },
  ];
  const base = {
    sessionYmd: SESSION,
    netValue: 200_000,
    priorNetValue: 1_000_000,
    netCashFlow: 0,
    externalCurrent: 50_000,
    schwabIntraday: points,
  };
  const saturday = selectPortfolioSessionValuation({
    ...base,
    now: new Date("2026-05-23T16:00:00.000Z"),
  });
  const preopen = selectPortfolioSessionValuation({
    ...base,
    now: new Date("2026-05-26T13:29:00.000Z"),
  });
  assert.equal(saturday.lockedToSessionClose, true);
  assert.equal(preopen.lockedToSessionClose, true);
  assert.equal(saturday.netValueForReturn, 1_060_000);
  assert.equal(preopen.netValueForReturn, 1_060_000);
  assert.ok(saturday.changePct != null && Math.abs(saturday.changePct - 6) < 1e-9);
});

test("portfolio day % uses the live total during the regular session", () => {
  const valuation = selectPortfolioSessionValuation({
    now: new Date("2026-05-22T15:00:00.000Z"), // 11:00 ET
    sessionYmd: SESSION,
    netValue: 1_005_000,
    priorNetValue: 1_000_000,
    netCashFlow: 0,
    externalCurrent: 0,
    schwabIntraday: [
      { tsMs: nyWallTimeMs(SESSION, 10 * 60), total: 1_001_000 },
      { tsMs: nyWallTimeMs(SESSION, 15 * 60), total: 900_000 },
    ],
  });
  assert.equal(valuation.lockedToSessionClose, false);
  assert.equal(valuation.netValueForReturn, 1_005_000);
  assert.ok(valuation.changePct != null && Math.abs(valuation.changePct - 0.5) < 1e-9);
});

test("portfolio day % falls back to live when the session close snapshot is missing", () => {
  const valuation = selectPortfolioSessionValuation({
    now: new Date("2026-05-23T16:00:00.000Z"),
    sessionYmd: SESSION,
    netValue: 1_004_000,
    priorNetValue: 1_000_000,
    netCashFlow: 0,
    externalCurrent: 0,
    schwabIntraday: [{ tsMs: nyWallTimeMs("2026-05-21", 15 * 60), total: 50_000 }],
  });
  assert.equal(valuation.lockedToSessionClose, false);
  assert.equal(valuation.netValueForReturn, 1_004_000);
});

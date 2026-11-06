import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { calendarDaysBetween, isoDate, makeOptionChain, type ChainDraft, type DraftContract } from "@/lib/optionChain/chain";
import { bsmGreeks, normCdf } from "@/lib/options/blackScholes";
import { createLab, editLab, evaluateLab } from "@/lib/strategyLab/lab";
import {
  expiryUnitDelta,
  hundredLines,
  packageExpiryDelta,
  peakDelta,
  positionShareDelta,
  presentDelta,
  sampleStockDelta,
  sampleStructureDelta,
  type DeltaLeg,
} from "@/lib/strategyLab/deltaCurves";

const assumptions = { rate: 0, dividendYield: 0, ivSource: "mid" as const };

function leg(right: "C" | "P", strike: number, ratio: number, iv: number | null = 0.2): DeltaLeg {
  return { right, strike, ratio, iv };
}

describe("expiry delta steps", () => {
  it("steps a call spread: 0 below the long strike, +100 between, 0 at and above the short strike", () => {
    const legs = [leg("C", 150, 1), leg("C", 210, -1)];
    assert.equal(packageExpiryDelta(legs, 100), 0);
    assert.equal(packageExpiryDelta(legs, 149.9), 0);
    assert.equal(packageExpiryDelta(legs, 150), 100);
    assert.equal(packageExpiryDelta(legs, 180), 100);
    assert.equal(packageExpiryDelta(legs, 209.9), 100);
    assert.equal(packageExpiryDelta(legs, 210), 0);
    assert.equal(packageExpiryDelta(legs, 250), 0);
    const three = (spot: number) =>
      positionShareDelta({ legs, packages: 3, assumptions, spot, years: 0 });
    assert.equal(three(100), 0);
    assert.equal(three(150), 300);
    assert.equal(three(180), 300);
    assert.equal(three(210), 0);
    assert.equal(three(250), 0);
  });

  it("ramps a ZEBRA to +100 per package at the short strike", () => {
    const legs = [leg("C", 120, 2), leg("C", 210, -1)];
    assert.equal(packageExpiryDelta(legs, 119.9), 0);
    assert.equal(packageExpiryDelta(legs, 120), 200);
    assert.equal(packageExpiryDelta(legs, 180), 200);
    assert.equal(packageExpiryDelta(legs, 209.9), 200);
    assert.equal(packageExpiryDelta(legs, 210), 100);
    assert.equal(packageExpiryDelta(legs, 400), 100);
    const sized = (spot: number) =>
      positionShareDelta({ legs, packages: 2.5, assumptions, spot, years: 0 });
    assert.equal(sized(100), 0);
    assert.equal(sized(120), 500);
    assert.equal(sized(210), 250);
  });

  it("holds a synthetic long at +100 and a short strangle at +100 / 0 / −100", () => {
    const synthetic = [leg("C", 140, 1), leg("P", 140, -1)];
    assert.equal(packageExpiryDelta(synthetic, 100), 100);
    assert.equal(packageExpiryDelta(synthetic, 140), 100);
    assert.equal(packageExpiryDelta(synthetic, 200), 100);
    const strangle = [leg("P", 90, -1), leg("C", 110, -1)];
    assert.equal(packageExpiryDelta(strangle, 80), 100);
    assert.equal(packageExpiryDelta(strangle, 90), 0);
    assert.equal(packageExpiryDelta(strangle, 100), 0);
    assert.equal(packageExpiryDelta(strangle, 110), -100);
    assert.equal(packageExpiryDelta(strangle, 140), -100);
  });

  it("counts a call as 1 at the strike and a put as 0 at the strike", () => {
    assert.equal(expiryUnitDelta("C", 100, 100), 1);
    assert.equal(expiryUnitDelta("C", 100, 99.9), 0);
    assert.equal(expiryUnitDelta("P", 100, 100), 0);
    assert.equal(expiryUnitDelta("P", 100, 99.9), -1);
  });
});

describe("constant entry IV", () => {
  it("matches N(d1) for an at-the-money call and keeps that vol at another spot", () => {
    const legs = [leg("C", 100, 1, 0.2)];
    const atm = positionShareDelta({ legs, packages: 1, assumptions, spot: 100, years: 1 });
    const hand = normCdf(0.1) * 100;
    assert.ok(atm != null);
    assert.ok(Math.abs(atm - hand) < 1e-9);
    assert.ok(Math.abs(hand - 53.9828) < 0.001);
    const model = bsmGreeks({
      right: "C",
      spot: 100,
      strike: 100,
      years: 1,
      rate: 0,
      dividendYield: 0,
      vol: 0.2,
    }).delta;
    assert.ok(Math.abs(atm - model * 100) < 1e-9);

    const lower = positionShareDelta({ legs, packages: 1, assumptions, spot: 80, years: 1 });
    const lowerModel =
      bsmGreeks({ right: "C", spot: 80, strike: 100, years: 1, rate: 0, dividendYield: 0, vol: 0.2 }).delta * 100;
    assert.ok(lower != null);
    assert.ok(Math.abs(lower - lowerModel) < 1e-9);
    assert.notEqual(Math.round(lower * 1000), Math.round(atm * 1000));
  });

  it("adds two legs at their own entry vols", () => {
    const legs = [leg("C", 100, 1, 0.2), leg("C", 120, -1, 0.35)];
    const years = 0.75;
    const spot = 110;
    const expected =
      (bsmGreeks({ right: "C", spot, strike: 100, years, rate: 0, dividendYield: 0, vol: 0.2 }).delta +
        bsmGreeks({ right: "C", spot, strike: 120, years, rate: 0, dividendYield: 0, vol: 0.35 }).delta * -1) *
      100;
    const got = positionShareDelta({ legs, packages: 1, assumptions, spot, years });
    assert.ok(got != null);
    assert.ok(Math.abs(got - expected) < 1e-9);
    const again = positionShareDelta({ legs, packages: 1, assumptions, spot: 90, years });
    const againExpected =
      (bsmGreeks({ right: "C", spot: 90, strike: 100, years, rate: 0, dividendYield: 0, vol: 0.2 }).delta +
        bsmGreeks({ right: "C", spot: 90, strike: 120, years, rate: 0, dividendYield: 0, vol: 0.35 }).delta * -1) *
      100;
    assert.ok(again != null && Math.abs(again - againExpected) < 1e-9);
  });

  it("breaks the line when a live leg has no IV and still steps at expiry", () => {
    const legs = [leg("C", 100, 1, null)];
    assert.equal(positionShareDelta({ legs, packages: 1, assumptions, spot: 100, years: 0.5 }), null);
    assert.equal(positionShareDelta({ legs, packages: 1, assumptions, spot: 100, years: 0 }), 100);
  });

  it("adds stock shares one for one, on top of the option delta", () => {
    const legs = [leg("C", 100, 1)];
    const withStock = positionShareDelta({
      legs,
      stockSharesPerPackage: 25,
      packages: 4,
      assumptions,
      spot: 140,
      years: 0,
    });
    assert.equal(withStock, 400 + 100);
    const stockOnly = positionShareDelta({
      legs: [],
      stockSharesPerPackage: 10,
      packages: 2,
      assumptions,
      spot: 50,
      years: 0.4,
    });
    assert.equal(stockOnly, 20);
  });
});

describe("delta scales", () => {
  it("turns shares into per-package, percent, exposure, and cost", () => {
    assert.equal(presentDelta(250, 2.5, 5000, 80, "package", "delta"), 100);
    assert.equal(presentDelta(250, 2.5, 5000, 80, "shares", "delta"), 250);
    assert.equal(presentDelta(250, 2.5, 5000, 80, "pct", "delta"), 250);
    assert.equal(presentDelta(50, 1, 1000, 80, "shares", "exposure"), 4000);
    assert.equal(presentDelta(250, 2.5, 5000, 80, "package", "exposure"), 8000);
    assert.equal(presentDelta(100, 1, 1000, 80, "shares", "cost"), 10);
    assert.equal(presentDelta(250, 2.5, 5000, 80, "package", "cost"), 20);
    assert.equal(presentDelta(0.4, 1, 1000, 80, "shares", "cost"), null);
    assert.equal(presentDelta(100, 1, 1000, 100, "shares", "omega"), 10);
    assert.equal(presentDelta(250, 2.5, 5000, 80, "package", "omega"), 4);
    assert.equal(presentDelta(0.4, 1, 1000, 80, "shares", "omega"), null);
  });

  it("marks 100 shares, and the first peak", () => {
    assert.deepEqual(hundredLines("package", [2.5]), [{ y: 100, label: "100 / pkg" }]);
    assert.deepEqual(hundredLines("pct", [2]), [{ y: 100, label: "100%" }]);
    const shares = hundredLines("shares", [1, 2.5, 2.5]);
    assert.deepEqual(shares, [
      { y: 100, label: "100 shares" },
      { y: 250, label: "2.5×100" },
    ]);
    assert.deepEqual(
      peakDelta([
        { spot: 10, value: 1 },
        { spot: 20, value: 5 },
        { spot: 30, value: 5 },
        { spot: 40, value: null },
      ]),
      { spot: 20, value: 5 },
    );
  });
});

describe("sampled lab delta", () => {
  it("reads sticky entry IV off a priced structure and steps the expiry curve", () => {
    const expiry = "2027-01-15";
    const contracts: DraftContract[] = [
      { expiry, right: "C", strike: 90, bid: 14, ask: 16, feedIv: null, multiplier: 100, root: null, openInterest: 1, volume: 1 },
      { expiry, right: "C", strike: 110, bid: 3, ask: 3.4, feedIv: null, multiplier: 100, root: null, openInterest: 1, volume: 1 },
    ];
    const draft: ChainDraft = {
      symbol: "NOW",
      spot: 100,
      tradeDate: "2026-10-08",
      quoteTime: null,
      source: "cboe",
      delayed: true,
      dividendYieldHint: 0,
      contracts,
      fetchedAt: "2026-10-08T16:00:00.000Z",
      servedFrom: "network",
      fallbackFrom: null,
    };
    const built = makeOptionChain(draft);
    assert.equal(built.ok, true);
    if (!built.ok) return;
    const evaluation = evaluateLab(
      editLab(
        createLab(built.chain),
        [
          { kind: "setAssumptions", patch: { rate: 0, dividendYield: 0, ivSource: "mid" } },
          { kind: "setBasis", basis: { kind: "perPackage" } },
          {
            kind: "addStructure",
            label: "Spread",
            expiry: isoDate(expiry),
            request: { template: "callDebitSpread", long: { by: "strike", strike: 90 }, short: { by: "strike", strike: 110 } },
          },
        ],
        built.chain,
      ),
      built.chain,
    );
    assert.equal(evaluation.assumptions.rate, 0.04);
    assert.equal(evaluation.assumptions.ivSource, "mid");
    const row = evaluation.structures.find((item) => item.status === "priced" && item.spec.label === "Spread");
    assert.ok(row && row.status === "priced");
    if (!row || row.status !== "priced") return;
    const expiryHorizon = evaluation.horizons.find((horizon) => horizon.settlement);
    const today = evaluation.horizons.find((horizon) => horizon.date === evaluation.entryDate && !horizon.settlement);
    assert.ok(expiryHorizon && today);
    if (!expiryHorizon || !today) return;
    assert.equal(sampleStructureDelta(evaluation, row.spec.id, expiryHorizon.id, 80, "shares", "delta"), 0);
    assert.equal(sampleStructureDelta(evaluation, row.spec.id, expiryHorizon.id, 90, "shares", "delta"), 100);
    assert.equal(sampleStructureDelta(evaluation, row.spec.id, expiryHorizon.id, 100, "shares", "delta"), 100);
    assert.equal(sampleStructureDelta(evaluation, row.spec.id, expiryHorizon.id, 110, "shares", "delta"), 0);

    const years = calendarDaysBetween(today.date, row.spec.expiry) / 365;
    const ivLong = row.legs[0]?.iv;
    const ivShort = row.legs[1]?.iv;
    assert.ok(ivLong != null && ivShort != null);
    if (ivLong == null || ivShort == null) return;
    const spot = 95;
    const expected =
      (bsmGreeks({ right: "C", spot, strike: 90, years, rate: 0.04, dividendYield: 0, vol: ivLong }).delta -
        bsmGreeks({ right: "C", spot, strike: 110, years, rate: 0.04, dividendYield: 0, vol: ivShort }).delta) *
      100;
    const live = sampleStructureDelta(evaluation, row.spec.id, today.id, spot, "shares", "delta");
    assert.ok(live != null);
    assert.ok(Math.abs(live - expected) < 1e-6);
    const stock = sampleStockDelta(evaluation, 200, "shares", "delta");
    assert.equal(stock, 100);
    assert.equal(sampleStockDelta(evaluation, 200, "shares", "cost"), evaluation.spot);
    const omega = sampleStructureDelta(evaluation, row.spec.id, today.id, spot, "shares", "omega");
    assert.ok(omega != null && live != null && row.sizing.status !== "needsCapitalOverride");
    if (row.sizing.status === "needsCapitalOverride") return;
    assert.ok(Math.abs((omega ?? 0) - (live * spot) / (row.debit * row.sizing.packages)) < 1e-6);
    assert.equal(sampleStructureDelta(evaluation, row.spec.id, today.id, spot, "package", "omega"), omega);
    assert.equal(sampleStructureDelta(evaluation, row.spec.id, expiryHorizon.id, 110, "shares", "omega"), null);
    assert.equal(sampleStockDelta(evaluation, evaluation.spot, "shares", "omega"), 1);
    assert.equal(sampleStockDelta(evaluation, 200, "shares", "omega"), 2);
  });
});

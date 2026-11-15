import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { evaluateFortress } from "@/lib/fortress/evaluate";
import { medianDailyVolume, positionLiquidity } from "@/lib/fortress/liquidity";
import { regTMargin } from "@/lib/fortress/optionMargin";
import { gapFactor, replayAdjusted, shockFactor, STYLE_SHOCKS } from "@/lib/fortress/scenarios";
import { sourcedName, sourcedValue } from "@/lib/fortress/sourcedExposure";
import type { OptionContract, Snapshot } from "@/lib/fortress/types";
import { RECORDED_BOOK } from "@/lib/fortress/types";

function contract(right: "C" | "P", strike: number): OptionContract {
  return {
    underlying: "SYN",
    right,
    strike,
    expiry: "2027-06-18",
    style: "american",
    multiplier: 100,
    deliverableShares: 100,
    settlement: "physical",
    adjusted: false,
    adjustedMetadata: "complete",
    exotic: false,
  };
}

function book(positions: Snapshot["positions"], cash = 0): Snapshot {
  return {
    id: "opt",
    version: 1,
    currency: "USD",
    asOf: "2026-11-15",
    seed: 1,
    scope: { regime: "synthetic", label: "Synthetic option book. Not a household book." },
    completeness: RECORDED_BOOK,
    vintages: { quotes: "fixture", model: "fortress-ledger-1", rules: "manual-margin-1" },
    positions,
    cash: [{ id: "cash", accountId: "primary", amount: cash }],
    receivables: [],
    payables: [],
    debt: [],
    dividends: [],
    margin: { maintenanceLong: 0.3, initialLong: 0.5, provenance: "manual-assumption" },
    appliedOpIds: [],
    appliedEventIds: [],
    realized: [],
    residuals: [],
    externalCapital: 0,
  };
}

describe("listed option margin", () => {
  it("charges an uncovered call the FINRA 20 percent add-on and not the long-stock formula", () => {
    const snapshot = book(
      [{ id: "call", kind: "option", accountId: "primary", quantity: -1, averageCost: 2, mark: 2, delta: 0.5, gamma: 0.01, vegaPerVol: 10, contract: contract("C", 100) }],
      200,
    );
    const result = regTMargin(snapshot, { SYN: 100 }, 0.3);
    assert.equal(result.status, "known");
    assert.equal(result.requirement, 2_000);
    assert.equal(result.excess, -2_000);
    assert.match(result.source, /FINRA Rule 4210/);
    assert.equal(result.sourceDate, "2026-11-15");
  });

  it("uses the 10 percent floor for a deep out-of-the-money put", () => {
    const snapshot = book(
      [{ id: "put", kind: "option", accountId: "primary", quantity: -1, averageCost: 0.2, mark: 0.2, delta: -0.05, gamma: 0.01, vegaPerVol: 4, contract: contract("P", 50) }],
      20,
    );
    const result = regTMargin(snapshot, { SYN: 100 }, 0.3);
    assert.equal(result.requirement, 500);
  });

  it("keeps a covered call free of the uncovered add-on and gives a long option no loan value", () => {
    const covered = book([
      { id: "shares", kind: "equity", symbol: "SYN", accountId: "primary", quantity: 100, mark: 100, averageCost: 100 },
      { id: "call", kind: "option", accountId: "primary", quantity: -1, averageCost: 2, mark: 2, delta: 0.4, gamma: 0.01, vegaPerVol: 8, contract: contract("C", 100) },
    ]);
    const coveredResult = regTMargin(covered, { SYN: 100 }, 0.3);
    assert.equal(coveredResult.lines.find((line) => line.label.includes("short option"))?.amount, undefined);
    assert.equal(coveredResult.requirement, 3_000);

    const owned = book(
      [{ id: "long", kind: "option", accountId: "primary", quantity: 1, averageCost: 2, mark: 2, delta: 0.4, gamma: 0.01, vegaPerVol: 8, contract: contract("C", 100) }],
      0,
    );
    const ownedResult = regTMargin(owned, { SYN: 100 }, 0.3);
    assert.equal(ownedResult.excess, 0);
  });

  it("charges a vertical the full strike width and leaves a missing spot unknown", () => {
    const spread = book([
      { id: "short", kind: "option", accountId: "primary", quantity: -1, averageCost: 3, mark: 3, delta: 0.4, gamma: 0.01, vegaPerVol: 8, contract: contract("C", 100) },
      { id: "long", kind: "option", accountId: "primary", quantity: 1, averageCost: 1, mark: 1, delta: 0.2, gamma: 0.01, vegaPerVol: 6, contract: contract("C", 110) },
    ], 200);
    const result = regTMargin(spread, { SYN: 100 }, 0.3);
    assert.equal(result.requirement, 1_000);
    const missing = regTMargin(spread, {}, 0.3);
    assert.equal(missing.status, "unknown");
  });

  it("shows the Reg-T excess on an option path instead of the long-stock number", () => {
    const snapshot = book(
      [{ id: "put", kind: "option", accountId: "primary", quantity: -1, averageCost: 2, mark: 2, delta: -0.4, gamma: 0.02, vegaPerVol: 10, contract: contract("P", 100) }],
      200,
    );
    const result = evaluateFortress({
      baseline: snapshot,
      changes: [],
      market: { asOf: "2026-11-15", spots: { SYN: 100 }, vols: { SYN: 0.25 }, rate: 0.04, dividendYield: { SYN: 0 } },
      path: [
        { id: "now", date: "2026-11-15", spotFactor: 1, volAdd: 0, rateAdd: 0, houseHike: 0 },
        { id: "gap", date: "2026-11-16", spotFactor: 0.8, volAdd: 0, rateAdd: 0, houseHike: 0 },
      ],
    });
    const row = result.rows.find((item) => item.id === "maintenanceExcess");
    assert.match(row?.evidence ?? "", /FINRA Rule 4210/);
    assert.equal(row?.after != null, true);
    assert.equal(result.rows.find((item) => item.id === "criticalDecline")?.status, "not-evaluated");
    assert.notEqual(result.verdict.kind, "evaluated-pass");
  });
});

describe("style shocks, liquidity, and sourced exposures", () => {
  it("uses the observed index closes and a user gap, and leaves a short history blank", () => {
    const gfc = STYLE_SHOCKS.find((shock) => shock.id === "gfc");
    assert.ok(gfc);
    assert.ok(Math.abs(shockFactor(gfc!) - 676.53 / 1565.15) < 1e-12);
    assert.equal(gfc?.source, "Yahoo chart ^GSPC daily close");
    assert.equal(gapFactor(-20).factor, 0.8);
    assert.equal("factor" in gapFactor(-100) && gapFactor(-100).factor, null);
    const replay = replayAdjusted(
      [
        { date: "2020-02-19", adjClose: 100 },
        { date: "2020-03-23", adjClose: 70 },
      ],
      "2020-02-19",
      "2020-03-23",
    );
    assert.equal(replay.factor, 0.7);
    assert.equal(replayAdjusted([{ date: "2024-01-01", adjClose: 10 }], "2007-10-09", "2009-03-09").status, "unknown");
  });

  it("computes days and spread only from supplied volume and quotes", () => {
    const volume = medianDailyVolume([
      { date: "2026-11-13", volume: 100 },
      { date: "2026-11-14", volume: 300 },
      { date: "2026-11-15", volume: 0 },
    ]);
    assert.equal(volume.volume, 200);
    const priced = positionLiquidity({
      symbol: "SYN",
      shares: 1_000,
      averageDailyVolume: volume.volume,
      volumeSource: "Yahoo chart v8 indicators.quote.volume",
      volumeAsOf: volume.asOf,
      bid: 9.9,
      ask: 10.1,
      quoteSource: "user-entered quote",
      quoteAsOf: "2026-11-15",
    });
    assert.equal(priced.daysToLiquidate, 5);
    assert.ok(Math.abs((priced.spreadCost ?? 0) - 100) < 1e-9);
    const blank = positionLiquidity({
      symbol: "SYN",
      shares: 1_000,
      averageDailyVolume: null,
      volumeSource: null,
      volumeAsOf: null,
      bid: null,
      ask: null,
      quoteSource: null,
      quoteAsOf: null,
    });
    assert.equal(blank.daysToLiquidate, null);
    assert.equal(blank.spreadCost, null);
  });

  it("keeps sector, rates, and geography blank unless a dated non-demo source is present", () => {
    assert.equal(sourcedValue("Technology", "demoTaxonomy", "2026-11-15").value, null);
    assert.equal(sourcedValue("Technology", "schwab-instruments", null).value, null);
    const named = sourcedName({
      symbol: "aapl",
      sector: "Technology",
      sectorSource: "schwab-instruments",
      sectorAsOf: "2026-11-14",
      geography: null,
      geographySource: "schwab-instruments",
      geographyAsOf: "2026-11-14",
    });
    assert.equal(named.sector.value, "Technology");
    assert.equal(named.sector.asOf, "2026-11-14");
    assert.equal(named.rates.value, null);
    assert.equal(named.geography.value, null);
  });
});

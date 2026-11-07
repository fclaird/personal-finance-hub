import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { evaluateFortress, recoveryLabel, unitizedDrawdown } from "@/lib/fortress/evaluate";
import { gammaPnl, nWeight, signedNavWeight } from "@/lib/fortress/exposure";
import { criticalLongValue, declineToCritical } from "@/lib/fortress/margin";
import type { MarketNode, MarketState, OptionContract, Snapshot } from "@/lib/fortress/types";
import { DEFAULT_MARGIN } from "@/lib/fortress/types";

function stockBook(debt = 40_000, maintenance = 0.3): Snapshot {
  return {
    id: "fixture",
    version: 1,
    currency: "USD",
    asOf: "2026-11-06",
    seed: 7,
    scope: { regime: "synthetic", label: "Synthetic long stock. Not a household book." },
    vintages: { quotes: "fixture", model: "fortress-ledger-1", rules: "manual-margin-1" },
    positions: [{ id: "syn", kind: "equity", symbol: "SYN", accountId: "primary", quantity: 1000, mark: 100, averageCost: 100 }],
    cash: [{ id: "cash", accountId: "primary", amount: 0 }],
    receivables: [],
    payables: [],
    debt: [{ id: "debit", accountId: "primary", principal: debt, annualRate: 0 }],
    dividends: [],
    margin: { ...DEFAULT_MARGIN, maintenanceLong: maintenance },
    appliedOpIds: [],
    appliedEventIds: [],
    realized: [],
    residuals: [],
    externalCapital: 0,
  };
}

const market: MarketState = { asOf: "2026-11-06", spots: { SYN: 100 }, vols: { SYN: 0.25 }, rate: 0.04, dividendYield: { SYN: 0 } };

function path(factors: number[], hike = 0): MarketNode[] {
  return factors.map((spotFactor, index) => ({
    id: `n${index}`,
    date: "2026-11-06",
    spotFactor,
    volAdd: 0,
    rateAdd: 0,
    houseHike: hike,
  }));
}

const put = (expiry: string, id: string, quantity: number, strike = 100): Snapshot["positions"][number] => {
  const contract: OptionContract = {
    underlying: "SYN",
    right: "P",
    strike,
    expiry,
    style: "american",
    multiplier: 100,
    deliverableShares: 100,
    settlement: "physical",
    adjusted: false,
    adjustedMetadata: "complete",
    exotic: false,
  };
  return { id, kind: "option", accountId: "primary", quantity, averageCost: 2, mark: 2, delta: -0.4, gamma: 0.02, vegaPerVol: 15, contract };
};

describe("fortress phase 2", () => {
  it("matches the long-stock maintenance fixture", () => {
    assert.ok(Math.abs((criticalLongValue(40_000, 0.3) ?? 0) - 40_000 / 0.7) < 1e-6);
    assert.ok(Math.abs((declineToCritical(100_000, 40_000, 0.3) ?? 0) - 0.428571428) < 1e-6);
    assert.ok(Math.abs((declineToCritical(100_000, 40_000, 0.5) ?? 0) - 0.2) < 1e-9);
  });

  it("keeps the first breach when a later node recovers", () => {
    const result = evaluateFortress({
      baseline: stockBook(),
      changes: [],
      market,
      path: path([1, 0.8, 0.5, 0.9, 1]),
    });
    assert.equal(result.breach.status, "breach");
    assert.equal(result.rows.find((row) => row.id === "maintenanceExcess")?.status, "breach");
    assert.ok(Math.abs((result.rows.find((row) => row.id === "criticalDecline")?.after ?? 0) - 0.428571) < 1e-4);
    assert.equal(result.breach.nodeId, "n2");
    assert.ok((result.breach.refinedFactor ?? 1) < 0.8);
    assert.ok((result.breach.refinedFactor ?? 0) > 0.5);
    assert.equal(result.verdict.kind, "breach");
    assert.equal(result.verdict.summary.toLowerCase().includes("safe"), false);
    assert.deepEqual(result.baselinePath.map((point) => point.spotFactor), result.changedPath.map((point) => point.spotFactor));
  });

  it("moves the breach earlier when a house hike is added to the same path", () => {
    const plain = evaluateFortress({ baseline: stockBook(), changes: [], market, path: path([1, 0.9, 0.75]) });
    const hiked = evaluateFortress({ baseline: stockBook(), changes: [], market, path: path([1, 0.9, 0.75], 0.2) });
    assert.equal(plain.breach.status, "no-breach-tested");
    assert.equal(hiked.breach.status, "breach");
  });

  it("reports an already deficient book without a made-up decline", () => {
    const result = evaluateFortress({ baseline: stockBook(80_000, 0.3), changes: [], market, path: path([1, 0.9]) });
    assert.equal(result.breach.status, "already-deficient");
  });

  it("treats a missing delta as unknown and still lists a short", () => {
    const baseline = stockBook(0, 0.3);
    const unpriced = put("2027-06-18", "sp", -1);
    if (unpriced.kind !== "option") throw new Error("option");
    const withShort: Snapshot = {
      ...baseline,
      debt: [],
      positions: [baseline.positions[0]!, { ...unpriced, contract: { ...unpriced.contract, underlying: "NOPX" }, delta: null, gamma: null, vegaPerVol: null }],
    };
    const result = evaluateFortress({ baseline: withShort, changes: [], market, path: path([1]) });
    const n = result.rows.find((row) => row.id === "nWeight");
    assert.equal(n?.status, "unknown");
    assert.equal(result.verdict.kind, "blocked");
    assert.ok(result.after.positions.some((position) => position.kind === "option" && position.quantity < 0));
  });

  it("computes Nweight for two equal delta-dollar names and rejects a zero denominator", () => {
    const snapshot = stockBook(0, 0.3);
    const book: Snapshot = {
      ...snapshot,
      debt: [],
      positions: [
        { id: "a", kind: "equity", symbol: "AAA", accountId: "primary", quantity: 10, mark: 10, averageCost: 10 },
        { id: "b", kind: "equity", symbol: "BBB", accountId: "primary", quantity: -10, mark: 10, averageCost: 10 },
      ],
    };
    const result = evaluateFortress({
      baseline: book,
      changes: [],
      market: { ...market, spots: { AAA: 10, BBB: 10, SYN: 100 } },
      path: path([1]),
    });
    const n = result.rows.find((row) => row.id === "nWeight");
    assert.equal(n?.after, 2);
    const flat = nWeight([]);
    assert.equal(flat.status, "unknown");
    assert.equal(signedNavWeight({ status: "known", value: 10 }, 0).status, "unknown");
  });

  it("assigns a short put without exercising a longer protective put", () => {
    const shares = stockBook(0, 0.3).positions[0]!;
    const baseline: Snapshot = {
      ...stockBook(0, 0.3),
      debt: [],
      positions: [
        shares,
        put("2026-11-06", "short", -1, 100),
        { ...put("2027-06-18", "long", 1, 100), delta: -0.3 },
      ],
    };
    const result = evaluateFortress({
      baseline,
      changes: [],
      market,
      path: [{ id: "expiry", date: "2026-11-06", spotFactor: 0.9, volAdd: 0, rateAdd: 0, houseHike: 0 }],
    });
    const equity = result.changedTerminal.positions.find((position) => position.kind === "equity");
    const short = result.changedTerminal.positions.find((position) => position.id === "short");
    const protective = result.changedTerminal.positions.find((position) => position.id === "long");
    assert.equal(equity?.kind === "equity" && equity.quantity, 1100);
    assert.equal(short, undefined);
    assert.equal(protective?.kind === "option" && protective.quantity, 1);
    assert.ok(result.changedTerminal.payables.some((row) => row.amount === 10_000));
    assert.equal(result.phasesUnavailable.includes(3), true);
  });

  it("does not call an unrecovered drawdown zero and does not treat a deposit as profit", () => {
    const down = unitizedDrawdown([100, 80, 90], [0, 0, 0]);
    assert.ok((down.maxDrawdown ?? 0) > 0.19);
    assert.equal(down.recovered, false);
    assert.equal(recoveryLabel(false), "Not recovered by horizon.");
    const deposited = unitizedDrawdown([100, 150], [0, 50]);
    assert.ok((deposited.maxDrawdown ?? 0) < 1e-8);
    const dead = unitizedDrawdown([100, 0], [0, 0]);
    assert.equal(dead.survival, "failed");
    assert.equal(dead.maxDrawdown, null);
  });

  it("blocks an adjusted contract instead of dropping it", () => {
    const baseline = stockBook(0, 0.3);
    const adjusted = put("2027-01-15", "adj", -1);
    if (adjusted.kind !== "option") throw new Error("option");
    const book: Snapshot = { ...baseline, debt: [], positions: [{ ...adjusted, contract: { ...adjusted.contract, adjusted: true, adjustedMetadata: "missing" } }] };
    const result = evaluateFortress({ baseline: book, changes: [], market, path: path([1, 1.2]) });
    assert.equal(result.changedPath[0]?.blocked?.includes("adjusted"), true);
    assert.equal(result.verdict.kind, "blocked");
  });

  it("labels gamma P&L unknown when gamma is missing", () => {
    const known = gammaPnl([{ quantity: -1, multiplier: 100, gamma: 0.02, dSpot: 1 }]);
    assert.equal(known.status === "known" && known.value, -1);
    assert.equal(gammaPnl([{ quantity: -1, multiplier: 100, gamma: null, dSpot: 1 }]).status, "unknown");
  });
});

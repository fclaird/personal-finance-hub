import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { applyChangeSet, cloneSnapshot, netAssetValue, snapshotUnchanged } from "@/lib/fortress/ledger";
import type { OptionContract, Snapshot } from "@/lib/fortress/types";
import { DEFAULT_MARGIN, RECORDED_BOOK } from "@/lib/fortress/types";

function book(partial: Partial<Snapshot> = {}): Snapshot {
  return {
    id: "snap",
    version: 1,
    currency: "USD",
    asOf: "2026-11-06",
    seed: 1,
    scope: { regime: "synthetic", label: "Synthetic fixture" },
    completeness: RECORDED_BOOK,
    vintages: { quotes: "2026-11-06", model: "fortress-ledger-1", rules: "manual-margin-1" },
    positions: [],
    cash: [{ id: "cash", accountId: "primary", amount: 0 }],
    receivables: [],
    payables: [],
    debt: [],
    dividends: [],
    margin: DEFAULT_MARGIN,
    appliedOpIds: [],
    appliedEventIds: [],
    realized: [],
    residuals: [],
    externalCapital: 0,
    ...partial,
  };
}

const contract: OptionContract = {
  underlying: "SYN",
  right: "P",
  strike: 100,
  expiry: "2027-01-15",
  style: "american",
  multiplier: 100,
  deliverableShares: 100,
  settlement: "physical",
  adjusted: false,
  adjustedMetadata: "complete",
  exotic: false,
};

describe("fortress ledger", () => {
  it("leaves the baseline unchanged and ignores a repeated operation id", () => {
    const baseline = book({ cash: [{ id: "cash", accountId: "primary", amount: 50 }] });
    const before = cloneSnapshot(baseline);
    const once = applyChangeSet(baseline, [{ op: "deposit", id: "d1", accountId: "primary", amount: 25, tradeDate: "2026-11-06" }]);
    const twice = applyChangeSet(once.snapshot, [{ op: "deposit", id: "d1", accountId: "primary", amount: 25, tradeDate: "2026-11-06" }]);
    assert.equal(snapshotUnchanged(before, baseline), true);
    assert.equal(netAssetValue(twice.snapshot).status === "known" && netAssetValue(twice.snapshot).value, 75);
  });

  it("raises cash and debt together on a borrow, so NAV is unchanged before fees", () => {
    const baseline = book({ positions: [{ id: "s", kind: "equity", symbol: "SYN", accountId: "primary", quantity: 1000, mark: 100, averageCost: 100 }] });
    const next = applyChangeSet(baseline, [{ op: "borrow", id: "b1", accountId: "primary", amount: 40_000, annualRate: 0, tradeDate: "2026-11-06" }]);
    const nav = netAssetValue(next.snapshot);
    assert.equal(nav.status, "known");
    if (nav.status === "known") assert.equal(nav.value, 100_000);
    assert.equal(next.snapshot.debt[0]?.principal, 40_000);
    assert.equal(next.snapshot.cash[0]?.amount, 40_000);
    assert.equal(next.snapshot.externalCapital, 0);
  });

  it("counts a deposit as external capital and not as realized profit", () => {
    const next = applyChangeSet(book(), [{ op: "deposit", id: "d", accountId: "primary", amount: 500, tradeDate: "2026-11-06" }]);
    const nav = netAssetValue(next.snapshot);
    assert.equal(nav.status === "known" && nav.value, 500);
    assert.equal(next.snapshot.externalCapital, 500);
    assert.equal(next.snapshot.realized.length, 0);
  });

  it("books option premium as cash and an offsetting liability, so NAV moves only by the fee", () => {
    const baseline = book({ cash: [{ id: "cash", accountId: "primary", amount: 0 }] });
    const next = applyChangeSet(baseline, [{
      op: "openOption",
      id: "short-put",
      accountId: "primary",
      quantity: -1,
      contract,
      fill: { price: 2, tradeDate: "2026-11-06", fee: 1 },
    }]);
    const nav = netAssetValue(next.snapshot);
    assert.equal(nav.status, "known");
    if (nav.status === "known") assert.ok(Math.abs(nav.value - -1) < 1e-6);
    const premium = next.snapshot.receivables.find((row) => row.label === "Option premium received");
    assert.equal(premium?.amount, 200);
    assert.equal(premium?.due, "2026-11-07");
    assert.equal(next.snapshot.positions[0]?.kind === "option" && next.snapshot.positions[0].quantity, -1);
  });

  it("rejects a trim that would open a short and leaves the shares in place", () => {
    const baseline = book({ positions: [{ id: "s", kind: "equity", symbol: "SYN", accountId: "primary", quantity: 10, mark: 100, averageCost: 90 }] });
    const next = applyChangeSet(baseline, [{ op: "trimEquity", id: "t", accountId: "primary", symbol: "SYN", quantity: 11, fill: { price: 100, tradeDate: "2026-11-06", fee: 0 } }]);
    assert.equal(next.results[0]?.accepted, false);
    assert.equal(next.snapshot.positions[0]?.kind === "equity" && next.snapshot.positions[0].quantity, 10);
  });

  it("keeps a sale unsettled until T+1", () => {
    const baseline = book({ positions: [{ id: "s", kind: "equity", symbol: "SYN", accountId: "primary", quantity: 10, mark: 100, averageCost: 100 }] });
    const next = applyChangeSet(baseline, [{ op: "trimEquity", id: "t", accountId: "primary", symbol: "SYN", quantity: 4, fill: { price: 110, tradeDate: "2026-11-06", fee: 0 } }]);
    assert.equal(next.snapshot.cash[0]?.amount, 0);
    assert.equal(next.snapshot.receivables[0]?.amount, 440);
    assert.equal(next.snapshot.receivables[0]?.due, "2026-11-07");
    assert.equal(next.snapshot.positions[0]?.kind === "equity" && next.snapshot.positions[0].quantity, 6);
  });

  it("reconciles a roll as a separate close and open", () => {
    const baseline = book({
      positions: [{ id: "old", kind: "option", accountId: "primary", quantity: -1, averageCost: 2, mark: 2, delta: null, gamma: null, vegaPerVol: null, contract }],
    });
    const opened = { ...contract, strike: 95, expiry: "2027-02-19" };
    const next = applyChangeSet(baseline, [{
      op: "roll",
      id: "roll-1",
      timing: "simultaneous",
      close: { positionId: "old", quantity: 1, fill: { price: 1.5, tradeDate: "2026-11-06", fee: 0 } },
      open: { accountId: "primary", quantity: -1, contract: opened, fill: { price: 1.8, tradeDate: "2026-11-06", fee: 0 } },
    }]);
    assert.equal(next.results[0]?.accepted, true);
    assert.equal(next.snapshot.positions.some((position) => position.id === "old"), false);
    const replacement = next.snapshot.positions.find((position) => position.id === "roll-1:open");
    assert.equal(replacement?.kind === "option" && replacement.contract.strike, 95);
    assert.equal(next.snapshot.realized.some((row) => row.id === "roll-1:close:realized"), true);
    assert.ok(next.snapshot.residuals.some((row) => row.label.includes("simultaneous")));
  });

  it("accepts each promised change form on a book that can fund it", () => {
    const funded = book({
      cash: [{ id: "cash", accountId: "primary", amount: 50_000 }],
      positions: [
        { id: "s", kind: "equity", symbol: "SYN", accountId: "primary", quantity: 100, mark: 100, averageCost: 100 },
        { id: "old", kind: "option", accountId: "primary", quantity: -1, averageCost: 2, mark: 2, delta: -0.4, gamma: 0.01, vegaPerVol: 10, contract },
      ],
      debt: [{ id: "loan", accountId: "primary", principal: 1_000, annualRate: 0 }],
    });
    const opened = { ...contract, strike: 90 };
    const changes = [
      { op: "addEquity" as const, id: "add", accountId: "primary", symbol: "NEW", instrument: "equity" as const, quantity: 1, fill: { price: 10, tradeDate: "2026-11-06", fee: 0 } },
      { op: "trimEquity" as const, id: "trim", accountId: "primary", symbol: "SYN", quantity: 10, fill: { price: 100, tradeDate: "2026-11-06", fee: 0 } },
      { op: "deposit" as const, id: "dep", accountId: "primary", amount: 5, tradeDate: "2026-11-06" },
      { op: "withdraw" as const, id: "wd", accountId: "primary", amount: 5, tradeDate: "2026-11-06" },
      { op: "borrow" as const, id: "br", accountId: "primary", amount: 20, annualRate: 0, tradeDate: "2026-11-06" },
      { op: "repay" as const, id: "rp", accountId: "primary", amount: 20, annualRate: 0, tradeDate: "2026-11-06" },
      { op: "transfer" as const, id: "tr", fromAccountId: "primary", toAccountId: "reserve", amount: 10, tradeDate: "2026-11-06" },
      { op: "setMargin" as const, id: "mg", maintenanceLong: 0.25, initialLong: 0.5 },
      { op: "closeOption" as const, id: "cl", positionId: "old", quantity: 1, fill: { price: 1, tradeDate: "2026-11-06", fee: 0 } },
      { op: "openOption" as const, id: "opn", accountId: "primary", quantity: -1, contract: opened, fill: { price: 1.2, tradeDate: "2026-11-06", fee: 0 } },
      { op: "replace" as const, id: "rp2", accountId: "primary", sellSymbol: "SYN", sellQuantity: 5, buySymbol: "ALT", buyInstrument: "etf" as const, sellFill: { price: 100, tradeDate: "2026-11-06", fee: 0 }, buyFill: { price: 50, tradeDate: "2026-11-06", fee: 0 } },
    ];
    const next = applyChangeSet(funded, changes);
    assert.deepEqual(next.results.map((result) => result.accepted), changes.map(() => true));
    assert.equal(next.snapshot.margin.maintenanceLong, 0.25);
    assert.equal(next.snapshot.externalCapital, 0);
    const rolled = applyChangeSet(funded, [{
      op: "roll",
      id: "roll",
      timing: "simultaneous",
      close: { positionId: "old", quantity: 1, fill: { price: 1, tradeDate: "2026-11-06", fee: 0 } },
      open: { accountId: "primary", quantity: -1, contract: opened, fill: { price: 1.1, tradeDate: "2026-11-06", fee: 0 } },
    }]);
    assert.equal(rolled.results[0]?.accepted, true);
  });

  it("moves cash between accounts without counting it as external capital", () => {
    const baseline = book({
      cash: [
        { id: "a", accountId: "a", amount: 100 },
        { id: "b", accountId: "b", amount: 0 },
      ],
    });
    const next = applyChangeSet(baseline, [{ op: "transfer", id: "x", fromAccountId: "a", toAccountId: "b", amount: 40, tradeDate: "2026-11-06" }]);
    assert.equal(next.snapshot.externalCapital, 0);
    assert.equal(netAssetValue(next.snapshot).status === "known" && netAssetValue(next.snapshot).value, 100);
    assert.equal(next.snapshot.cash.find((row) => row.accountId === "b")?.amount, 40);
  });
});

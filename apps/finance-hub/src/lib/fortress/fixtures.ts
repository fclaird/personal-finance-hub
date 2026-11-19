import type { MarketNode, MarketState, Snapshot } from "@/lib/fortress/types";
import { DEFAULT_MARGIN, RECORDED_BOOK } from "@/lib/fortress/types";

/** Synthetic long stock and debit. Not a household portfolio and not a broker margin schedule. */
export function syntheticMarginFixture(): { snapshot: Snapshot; market: MarketState; path: MarketNode[] } {
  const snapshot: Snapshot = {
    id: "synthetic-margin",
    version: 1,
    currency: "USD",
    asOf: "2026-11-06",
    seed: 7,
    scope: { regime: "synthetic", label: "Synthetic 1,000 shares of SYN at 100, debit 40,000." },
    completeness: RECORDED_BOOK,
    vintages: { quotes: "synthetic-fixture", model: "fortress-ledger-1", rules: "manual-margin-1" },
    positions: [{ id: "syn", kind: "equity", symbol: "SYN", accountId: "primary", quantity: 1000, mark: 100, averageCost: 100 }],
    cash: [{ id: "cash", accountId: "primary", amount: 0 }],
    receivables: [],
    payables: [],
    debt: [{ id: "debit", accountId: "primary", principal: 40_000, annualRate: 0 }],
    dividends: [],
    margin: DEFAULT_MARGIN,
    appliedOpIds: [],
    appliedEventIds: [],
    realized: [],
    residuals: [],
    externalCapital: 0,
  };
  const market: MarketState = { asOf: "2026-11-06", spots: { SYN: 100 }, vols: { SYN: 0.25 }, rate: 0.04, dividendYield: { SYN: 0 } };
  const path = [1, 0.8, 0.5714, 0.5, 1.2].map((spotFactor, index) => ({
    id: `p${index}`,
    date: "2026-11-06",
    spotFactor,
    volAdd: 0,
    rateAdd: 0,
    houseHike: 0,
  }));
  return { snapshot, market, path };
}

/** Synthetic uncovered call with the premium sitting in cash. Not a household book. */
export function syntheticUncoveredCall(): Snapshot {
  return {
    id: "synthetic-uncovered-call",
    version: 1,
    currency: "USD",
    asOf: "2026-11-15",
    seed: 11,
    scope: { regime: "synthetic", label: "Synthetic uncovered SYN call. Not a household book." },
    completeness: RECORDED_BOOK,
    vintages: { quotes: "synthetic-fixture", model: "fortress-ledger-1", rules: "manual-margin-1" },
    positions: [{
      id: "call",
      kind: "option",
      accountId: "primary",
      quantity: -1,
      averageCost: 2,
      mark: 2,
      delta: 0.5,
      gamma: 0.01,
      vegaPerVol: 10,
      contract: {
        underlying: "SYN",
        right: "C",
        strike: 100,
        expiry: "2027-06-18",
        style: "american",
        multiplier: 100,
        deliverableShares: 100,
        settlement: "physical",
        adjusted: false,
        adjustedMetadata: "complete",
        exotic: false,
      },
    }],
    cash: [{ id: "cash", accountId: "primary", amount: 200 }],
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
  };
}

export function isCurrentRun(runId: number, latest: number): boolean {
  return runId === latest;
}

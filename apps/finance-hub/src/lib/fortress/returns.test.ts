import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { displayedVerdict } from "@/lib/fortress/returns";
import { buildReturnReport, isPositiveSemidefinite, MIN_RETURN_SAMPLE, weightsFromSnapshot } from "@/lib/fortress/returns";
import { buildUserBook } from "@/lib/fortress/userBook";
import type { Snapshot } from "@/lib/fortress/types";
import type { AdjBar } from "@/lib/market/adjustedClose";

function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

function bars(values: readonly number[], start = "2024-01-01"): AdjBar[] {
  let price = 100;
  const out: AdjBar[] = [{ date: start, adjClose: price }];
  for (let i = 0; i < values.length; i++) {
    price *= 1 + values[i]!;
    out.push({ date: addDays(start, i + 1), adjClose: price });
  }
  return out;
}

function holding(symbol: string, weight: number | null, proxy = false) {
  return { symbol, weight, proxy };
}

const asOf = addDays("2024-01-01", 120);

function longReturns(fn: (index: number) => number, count = 120): number[] {
  return Array.from({ length: count }, (_, index) => fn(index));
}

describe("adjusted return panel", () => {
  const count = 120;
  const alpha = longReturns((index) => (index % 2 === 0 ? -0.02 : 0.01), count);
  const beta = longReturns((index) => (index % 2 === 0 ? -0.01 : 0.008), count);
  const bench = longReturns((index) => (index % 2 === 0 ? -0.012 : 0.006), count);
  const series = [
    { symbol: "AAA", bars: bars(alpha) },
    { symbol: "BBB", bars: bars(beta) },
    { symbol: "SPY", bars: bars(bench) },
  ];
  const before = [holding("AAA", 0.8), holding("BBB", -0.25)];
  const after = [holding("AAA", 0.5), holding("BBB", -0.4)];

  it("uses one common date set and keeps a negative risk contribution", () => {
    const report = buildReturnReport({ asOf, benchmark: "SPY", series, before, after, maxAbsCorrelation: null });
    assert.equal(report.full.status, "computed");
    assert.equal(report.full.observations, count);
    assert.equal(report.full.before[0]?.observations, report.full.after[0]?.observations);
    assert.ok((report.full.before[0]?.observations ?? 0) >= MIN_RETURN_SAMPLE);
    assert.equal(report.rolling.status, "computed");
    assert.equal(report.benchmarkDown.status, "computed");
    assert.equal(report.benchmarkDown.observations, count / 2);
    assert.equal(report.covariance?.psd, true);
    assert.equal(report.beforeRisk.status, "computed");
    assert.equal(report.beforeRisk.identity, true);
    assert.ok(report.beforeRisk.contributions.some((row) => row.contribution < 0));
    const sum = report.beforeRisk.contributions.reduce((total, row) => total + row.contribution, 0);
    assert.ok(Math.abs(sum - (report.beforeRisk.sigma ?? 0)) < 1e-6);
    assert.equal(report.gate, "complete");
    assert.match(report.tailNote, /expected shortfall/i);
  });

  it("drops a short candidate and reports the baseline dates that matching would lose", () => {
    const short = longReturns((index) => (index % 2 === 0 ? -0.01 : 0.01), 10);
    const candidate = longReturns((index) => (index % 2 === 0 ? -0.01 : 0.004), 70);
    const report = buildReturnReport({
      asOf,
      benchmark: "SPY",
      series: [...series, { symbol: "NEW", bars: bars(short) }, { symbol: "LATE", bars: bars(candidate, addDays("2024-01-01", 50)) }],
      before,
      after: [...after, holding("NEW", 0.1)],
    });
    assert.equal(report.excluded.find((row) => row.symbol === "NEW")?.reason, "short-history");
    assert.equal(report.excluded.find((row) => row.symbol === "NEW")?.observations, 10);
    assert.equal(report.afterRisk.status, "unknown");
    assert.equal(report.gate, "blocked");

    const matched = buildReturnReport({
      asOf,
      benchmark: "SPY",
      series: [...series, { symbol: "LATE", bars: bars(candidate, addDays("2024-01-01", 50)) }],
      before,
      after: [...after, holding("LATE", 0.1)],
    });
    assert.equal(matched.comparisonDates.length, 70);
    assert.equal(matched.lostBaselineDates, 50);
    assert.equal(matched.full.before[0]?.observations, 70);
    assert.equal(matched.full.after[0]?.observations, 70);
  });

  it("rejects zero variance, a zero risk denominator, and a missing adjusted series", () => {
    const flat = buildReturnReport({
      asOf,
      benchmark: "SPY",
      series: [...series, { symbol: "FLAT", bars: bars(Array(count).fill(0)) }],
      before: [...before, holding("FLAT", 0.1)],
      after,
    });
    assert.equal(flat.excluded.find((row) => row.symbol === "FLAT")?.reason, "zero-variance");
    assert.equal(flat.gate, "blocked");

    const hedged = buildReturnReport({
      asOf,
      benchmark: "SPY",
      series,
      before: [holding("AAA", 1), holding("BBB", -1)],
      after: [holding("AAA", 1), holding("BBB", -1)],
    });
    const identical = buildReturnReport({
      asOf,
      benchmark: "SPY",
      series: [
        { symbol: "AAA", bars: bars(alpha) },
        { symbol: "BBB", bars: bars(alpha) },
        { symbol: "SPY", bars: bars(bench) },
      ],
      before: [holding("AAA", 0.5), holding("BBB", -0.5)],
      after: [holding("AAA", 0.5), holding("BBB", -0.5)],
    });
    assert.equal(identical.beforeRisk.status, "unknown");
    assert.match(identical.beforeRisk.reason ?? "", /zero/i);
    assert.equal(hedged.beforeRisk.status, "computed");

    const missing = buildReturnReport({
      asOf,
      benchmark: "SPY",
      series: [{ symbol: "AAA", bars: null, reason: "no-adjclose" }, { symbol: "SPY", bars: bars(bench) }],
      before: [holding("AAA", 1)],
      after: [holding("AAA", 1)],
    });
    assert.equal(missing.excluded[0]?.reason, "no-adjclose");
    assert.equal(missing.gate, "blocked");
    assert.equal(displayedVerdict({ kind: "evaluated-pass", summary: "rows passed" }, missing).kind, "blocked");
    assert.equal(displayedVerdict({ kind: "breach", summary: "maintenance failed" }, missing).kind, "breach");
    assert.equal(displayedVerdict({ kind: "evaluated-pass", summary: "rows passed" }, null).kind, "blocked");
  });

  it("blocks a pass when the common overlap is below the minimum and when a correlation limit fails", () => {
    const partial = longReturns((index) => (index % 2 === 0 ? -0.01 : 0.01), 80);
    const other = longReturns((index) => (index % 2 === 0 ? 0.012 : -0.007), 80);
    const shifted = buildReturnReport({
      asOf: addDays("2024-01-01", 80),
      benchmark: "SPY",
      series: [
        { symbol: "AAA", bars: bars(partial) },
        { symbol: "BBB", bars: bars(other, addDays("2024-01-01", 40)) },
        { symbol: "SPY", bars: bars(bench.slice(0, 80)) },
      ],
      before: [holding("AAA", 0.5), holding("BBB", 0.5)],
      after: [holding("AAA", 0.5), holding("BBB", 0.5)],
    });
    assert.ok(shifted.comparisonDates.length < MIN_RETURN_SAMPLE);
    assert.equal(shifted.full.status, "unknown");
    assert.equal(shifted.gate, "blocked");

    const tight = buildReturnReport({ asOf, benchmark: "SPY", series, before, after, maxAbsCorrelation: 0.01 });
    assert.equal(tight.gate, "breach");
    assert.equal(displayedVerdict({ kind: "evaluated-pass", summary: "rows passed" }, tight).kind, "breach");
  });

  it("marks a stale series and keeps covariance positive semidefinite", () => {
    const stale = buildReturnReport({
      asOf: addDays(asOf, 30),
      benchmark: "SPY",
      series,
      before,
      after,
    });
    assert.ok(stale.excluded.every((row) => row.reason === "stale"));
    assert.equal(isPositiveSemidefinite([[1, 0.2], [0.2, 1]]), true);
    assert.equal(isPositiveSemidefinite([[1, 2], [2, 1]]), false);
  });

  it("collapses duplicate tickers, keeps a short, and labels an option as a linear proxy", () => {
    const book = buildUserBook({
      asOf: "2026-11-07",
      lines: [
        { symbol: "aaa", shares: 40, price: 10 },
        { symbol: "AAA", shares: 10, price: 10 },
        { symbol: "bbb", shares: -20, price: 5 },
      ],
      cash: 0,
      debt: 0,
    });
    assert.equal(book.ok, true);
    if (!book.ok) return;
    const unrecorded = buildUserBook({ asOf: "2026-11-07", lines: [{ symbol: "AAA", shares: 1, price: 10 }], cash: null, debt: null });
    assert.equal(unrecorded.ok, true);
    if (!unrecorded.ok) return;
    assert.equal(unrecorded.snapshot.completeness.cash, "missing");
    assert.equal(unrecorded.snapshot.completeness.debt, "missing");
    const weights = weightsFromSnapshot(book.snapshot);
    assert.deepEqual(weights.map((row) => row.symbol).sort(), ["AAA", "BBB"]);
    const aaa = weights.find((row) => row.symbol === "AAA");
    const bbb = weights.find((row) => row.symbol === "BBB");
    assert.ok(aaa && aaa.weight != null && aaa.weight > 0);
    assert.ok(bbb && bbb.weight != null && bbb.weight < 0);

    const optionBook: Snapshot = {
      ...book.snapshot,
      positions: [
        ...book.snapshot.positions,
        {
          id: "call",
          kind: "option",
          accountId: "primary",
          quantity: 1,
          averageCost: 2,
          mark: 2,
          delta: null,
          gamma: null,
          vegaPerVol: null,
          contract: {
            underlying: "AAA",
            right: "C",
            strike: 50,
            expiry: "2027-01-15",
            style: "american",
            multiplier: 100,
            deliverableShares: 100,
            settlement: "physical",
            adjusted: false,
            adjustedMetadata: "complete",
            exotic: false,
          },
        },
      ],
    };
    const proxied = weightsFromSnapshot(optionBook, { AAA: 10 });
    assert.equal(proxied.find((row) => row.symbol === "AAA")?.weight, null);
    assert.equal(proxied.find((row) => row.symbol === "AAA")?.proxy, true);
    const report = buildReturnReport({
      asOf,
      benchmark: "SPY",
      series,
      before: proxied,
      after: proxied,
    });
    assert.equal(report.proxyNote?.includes("option Greek delta"), true);
    assert.equal(report.gate, "blocked");
  });
});

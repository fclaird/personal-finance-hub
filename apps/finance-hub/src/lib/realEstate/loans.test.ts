import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  amortizeOneMonth,
  balanceForMonth,
  displayBalance,
  loanDetailsComplete,
  projectBalances,
  type BalancePoint,
  type LoanTerms,
} from "@/lib/realEstate/loans";

const incomplete: LoanTerms = {
  detailsComplete: false,
  annualRate: null,
  monthlyPayment: null,
  originalPrincipal: null,
  termMonths: null,
  startDate: null,
};

describe("loan balances", () => {
  it("does not amortize an incomplete owner estimate", () => {
    const points: BalancePoint[] = [{ asOf: "2026-10-06", balanceUsd: 745_000, source: "owner_estimate" }];
    const projected = projectBalances(incomplete, points, "2026-12");
    assert.deepEqual(projected, points);
    assert.equal(balanceForMonth(projected, "2026-12"), 745_000);
    assert.equal(displayBalance(points, "2026-06", false), 745_000);
    assert.equal(loanDetailsComplete(incomplete), false);
  });

  it("steps one month of interest and payment", () => {
    assert.equal(amortizeOneMonth(100_000, 0.06, 1_000), 99_500);
  });

  it("lets a later statement replace the schedule after its date", () => {
    const terms: LoanTerms = {
      detailsComplete: true,
      annualRate: 0.06,
      monthlyPayment: 1_000,
      originalPrincipal: 100_000,
      termMonths: 360,
      startDate: "2026-01-01",
    };
    const manuals: BalancePoint[] = [
      { asOf: "2026-01-31", balanceUsd: 100_000, source: "statement" },
      { asOf: "2026-03-15", balanceUsd: 99_000, source: "statement" },
    ];
    const projected = projectBalances(terms, manuals, "2026-04");
    assert.equal(balanceForMonth(projected, "2026-01"), 100_000);
    assert.equal(balanceForMonth(projected, "2026-02"), 99_500);
    assert.equal(balanceForMonth(projected, "2026-03"), 99_000);
    assert.equal(balanceForMonth(projected, "2026-04"), 98_495);
    assert.equal(
      projected.some((point) => point.source === "amortization" && point.asOf.startsWith("2026-03")),
      false,
    );
  });

  it("treats rate, start, and payment as enough to amortize", () => {
    assert.equal(
      loanDetailsComplete({
        annualRate: 0.065,
        monthlyPayment: 4_200,
        originalPrincipal: null,
        termMonths: null,
        startDate: "2024-06-21",
      }),
      true,
    );
  });
});

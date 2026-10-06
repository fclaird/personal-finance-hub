import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyPayment,
  buildMortgageView,
  projectPayoff,
  recomputeComputedSplits,
  resolveMortgageBalance,
  stepMonth,
  walkActual,
  type MortgageTerms,
  type PaymentDraft,
} from "@/lib/realEstate/mortgage";

const zero: MortgageTerms = {
  originalPrincipal: 1_000,
  annualRate: 0,
  termMonths: 12,
  firstPaymentDate: "2024-01-01",
  monthlyPayment: 100,
  monthlyEscrow: 0,
  extraPrincipal: 100,
};

describe("mortgage amortization", () => {
  it("pays off sooner with extra principal and saves the interest that extra avoids", () => {
    const idle = { ...zero, extraPrincipal: 0 };
    const asOf = "2023-12-31";
    const withExtra = projectPayoff(1_000, { ...zero, extraPrincipal: 100 }, 100, asOf);
    const without = projectPayoff(1_000, idle, 0, asOf);
    assert.deepEqual(withExtra, { date: "2024-05-01", months: 5, interest: 0 });
    assert.deepEqual(without, { date: "2024-10-01", months: 10, interest: 0 });
    const interestTerms: MortgageTerms = {
      originalPrincipal: 10_000,
      annualRate: 0.12,
      termMonths: 36,
      firstPaymentDate: "2024-01-01",
      monthlyPayment: 500,
      monthlyEscrow: 0,
      extraPrincipal: 80,
    };
    const extraPath = projectPayoff(10_000, interestTerms, 80, asOf);
    const notePath = projectPayoff(10_000, interestTerms, 0, asOf);
    assert.ok(extraPath && notePath);
    assert.ok(extraPath.months < notePath.months);
    assert.ok(notePath.interest - extraPath.interest > 0);
    assert.equal(stepMonth(10_000, 0.12, 500, 80).balance, 9_520);
    assert.equal(stepMonth(10_000, 0.12, 500, 0).balance, 9_600);
  });

  it("splits a total-only payment from the note and marks it computed", () => {
    const terms: MortgageTerms = {
      originalPrincipal: 10_000,
      annualRate: 0.12,
      termMonths: 360,
      firstPaymentDate: "2024-01-01",
      monthlyPayment: 500,
      monthlyEscrow: 200,
      extraPrincipal: 80,
    };
    const draft: PaymentDraft = {
      paidOn: "2024-01-01",
      totalPaid: 780,
      principal: null,
      interest: null,
      escrow: null,
      extraPrincipal: null,
      balanceAfter: null,
      notes: null,
    };
    const split = applyPayment(10_000, terms, draft);
    assert.equal(split.splitSource, "computed");
    assert.equal(split.interest, 100);
    assert.equal(split.principal, 400);
    assert.equal(split.escrow, 200);
    assert.equal(split.extraPrincipal, 80);
    assert.equal(split.balanceAfter, 9_520);
    const regular = applyPayment(10_000, terms, { ...draft, totalPaid: 700 });
    assert.equal(regular.escrow, 200);
    assert.equal(regular.extraPrincipal, 0);
    assert.equal(regular.balanceAfter, 9_600);
  });

  it("keeps a statement split instead of recomputing it", () => {
    const split = applyPayment(10_000, zero, {
      paidOn: "2024-02-01",
      totalPaid: 300,
      principal: 250,
      interest: 0,
      escrow: 0,
      extraPrincipal: 50,
      balanceAfter: 9_700,
      notes: "statement",
      splitSource: "statement",
    });
    assert.equal(split.splitSource, "statement");
    assert.equal(split.principal, 250);
    assert.equal(split.extraPrincipal, 50);
    assert.equal(split.balanceAfter, 9_700);
  });

  it("resolves statement, then amortization, then the owner estimate", () => {
    const estimate = { asOf: "2026-10-06", balanceUsd: 745_000 };
    assert.deepEqual(
      resolveMortgageBalance({ asOf: "2026-10-06", terms: null, payments: [], statements: [], ownerEstimate: estimate }),
      { balanceUsd: 745_000, asOf: "2026-10-06", source: "owner_estimate" },
    );

    const terms: MortgageTerms = { ...zero, extraPrincipal: 0, originalPrincipal: 1_000, firstPaymentDate: "2024-01-01" };
    const amortized = resolveMortgageBalance({
      asOf: "2024-03-01",
      terms,
      payments: [],
      statements: [],
      ownerEstimate: estimate,
    });
    assert.equal(amortized.source, "amortization");
    assert.equal(amortized.balanceUsd, 700);

    const stated = resolveMortgageBalance({
      asOf: "2024-03-01",
      terms,
      payments: [],
      statements: [{ asOf: "2024-02-15", balanceUsd: 888 }],
      ownerEstimate: estimate,
    });
    assert.deepEqual(stated, { balanceUsd: 888, asOf: "2024-02-15", source: "statement" });
  });

  it("uses a logged payment in place of that month's schedule, including its extra principal", () => {
    const terms: MortgageTerms = { ...zero, extraPrincipal: 0 };
    const walked = walkActual(
      terms,
      [
        {
          paidOn: "2024-02-01",
          totalPaid: 300,
          principal: null,
          interest: null,
          escrow: null,
          extraPrincipal: null,
          balanceAfter: null,
          notes: null,
        },
      ],
      [],
      "2024-03-01",
      null,
    );
    assert.equal(walked.balance, 500);
    assert.deepEqual(
      walked.months.map((point) => point.balance),
      [900, 600, 500],
    );
  });

  it("builds equity from the purchase month and stacks logged payment parts", () => {
    const terms: MortgageTerms = {
      ...zero,
      extraPrincipal: 80,
      firstPaymentDate: "2024-07-01",
      originalPrincipal: 1_000,
    };
    const view = buildMortgageView({
      asOf: "2024-08-15",
      lender: "Sample servicer",
      terms,
      payments: [
        {
          id: "p1",
          paidOn: "2024-07-01",
          totalPaid: 180,
          principal: 100,
          interest: 0,
          escrow: 0,
          extraPrincipal: 80,
          balanceAfter: null,
          notes: "sample",
          splitSource: "statement",
        },
      ],
      statements: [],
      ownerEstimate: { asOf: "2026-10-06", balanceUsd: 745_000 },
      officialValue: 1_200,
      official: [{ month: "2024-08", valueUsd: 1_200 }],
      purchaseMonth: "2024-06",
    });
    assert.equal(view.balanceSource, "amortization");
    assert.equal(view.equitySeries[0]?.month, "2024-06");
    assert.equal(view.equitySeries[0]?.equity, null);
    const august = view.equitySeries.find((point) => point.month === "2024-08");
    assert.equal(august?.value, 1_200);
    assert.ok(august && august.equity != null && august.equity > 0);
    assert.equal(view.paymentSeries[0]?.extra, 80);
    assert.equal(view.interestPaidToDate, 0);
    assert.ok(view.balanceSeries.some((point) => point.actual != null && point.scheduled != null));
    assert.ok(view.balanceSeries.some((point) => point.actualProjected != null && point.scheduledProjected != null));
    assert.ok(view.payoffWithExtra && view.payoffWithout && view.payoffWithExtra < view.payoffWithout);
  });

  it("re-splits a computed payment after an earlier month on the schedule", () => {
    const terms: MortgageTerms = { ...zero, extraPrincipal: 0, monthlyEscrow: 0 };
    const updates = recomputeComputedSplits(
      terms,
      [
        {
          id: "feb",
          paidOn: "2024-02-01",
          totalPaid: 100,
          principal: null,
          interest: null,
          escrow: null,
          extraPrincipal: null,
          balanceAfter: null,
          notes: null,
          splitSource: "computed",
        },
      ],
      [],
    );
    assert.equal(updates[0]?.principal, 100);
    assert.equal(updates[0]?.balanceAfter, 800);
    assert.equal(updates[0]?.splitSource, "computed");
  });
});

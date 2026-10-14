import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import Database from "better-sqlite3";

import { seedRealEstate } from "@/lib/realEstate/seed";
import { deleteLoanPayment, loadDashboard, saveLoanTerms, updateLoanPayment, upsertLoanPayments } from "@/lib/realEstate/store";

function memoryDb(): Database.Database {
  const db = new Database(":memory:");
  const schemaPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../db/schema.sql");
  db.exec(fs.readFileSync(schemaPath, "utf8"));
  seedRealEstate(db);
  return db;
}

describe("crownsville loan storage", () => {
  it("keeps the owner estimate until terms are saved, then updates the same loan row", () => {
    const db = memoryDb();
    const before = loadDashboard(db, 0, "2026-10");
    const crownsville = before.properties.find((property) => property.id === "re_crownsville");
    assert.equal(crownsville?.loanBalance, 745_000);
    assert.equal(crownsville?.loan?.mortgage?.ready, false);
    assert.equal(before.netWorth.mortgage, 745_000);

    saveLoanTerms(db, {
      propertyId: "re_crownsville",
      lender: "Sample servicer",
      originalPrincipal: 12_000,
      annualRate: 0,
      termMonths: 12,
      startDate: "2024-07-01",
      monthlyPayment: 1_000,
      monthlyEscrow: 0,
      extraPrincipal: 0,
    });
    const loanCount = db.prepare(`SELECT COUNT(*) AS n FROM real_estate_loans`).get() as { n: number };
    assert.equal(loanCount.n, 1);
    const stored = db.prepare(`SELECT lender, extra_principal AS extraPrincipal FROM real_estate_loans WHERE id = 're_loan_crownsville'`).get() as {
      lender: string;
      extraPrincipal: number;
    };
    assert.equal(stored.lender, "Sample servicer");
    assert.equal(stored.extraPrincipal, 0);

    const after = loadDashboard(db, 0, "2026-10");
    const paidOff = after.properties.find((property) => property.id === "re_crownsville");
    assert.equal(paidOff?.loan?.mortgage?.ready, true);
    assert.equal(paidOff?.loan?.balanceSource, "amortization");
    assert.equal(paidOff?.loanBalance, 0);
    assert.equal(after.netWorth.mortgage, 0);

    const first = upsertLoanPayments(db, "re_crownsville", [
      { paidOn: "2024-07-01", totalPaid: 1_000, principal: null, interest: null, escrow: null, extraPrincipal: null, balanceAfter: null, notes: "sample" },
    ]);
    upsertLoanPayments(db, "re_crownsville", [
      { paidOn: "2024-07-01", totalPaid: 1_080, principal: null, interest: null, escrow: null, extraPrincipal: null, balanceAfter: null, notes: "sample" },
    ]);
    const paymentCount = db.prepare(`SELECT COUNT(*) AS n FROM real_estate_loan_payments`).get() as { n: number };
    assert.equal(paymentCount.n, 1);
    assert.equal(first.length, 1);
    const row = db.prepare(`SELECT total_paid AS totalPaid, split_source AS splitSource, extra_principal AS extraPrincipal FROM real_estate_loan_payments`).get() as {
      totalPaid: number;
      splitSource: string;
      extraPrincipal: number;
    };
    assert.equal(row.totalPaid, 1_080);
    assert.equal(row.splitSource, "computed");
    assert.equal(row.extraPrincipal, 80);
    deleteLoanPayment(db, first[0]!);
    const remaining = db.prepare(`SELECT COUNT(*) AS n FROM real_estate_loan_payments`).get() as { n: number };
    assert.equal(remaining.n, 0);
  });

  it("re-splits a computed payment when an edit only corrects the total", () => {
    const db = memoryDb();
    saveLoanTerms(db, {
      propertyId: "re_crownsville",
      lender: "Sample servicer",
      originalPrincipal: 12_000,
      annualRate: 0,
      termMonths: 12,
      startDate: "2024-07-01",
      monthlyPayment: 1_000,
      monthlyEscrow: 0,
      extraPrincipal: 0,
    });
    const [id] = upsertLoanPayments(db, "re_crownsville", [
      { paidOn: "2024-07-01", totalPaid: 1_000, principal: null, interest: null, escrow: null, extraPrincipal: null, balanceAfter: null, notes: null },
    ]);
    const stored = db
      .prepare(
        `SELECT principal, interest, escrow, extra_principal AS extraPrincipal, balance_after AS balanceAfter
         FROM real_estate_loan_payments WHERE id = ?`,
      )
      .get(id) as { principal: number; interest: number; escrow: number | null; extraPrincipal: number; balanceAfter: number | null };
    assert.equal(stored.principal, 1_000);
    assert.equal(stored.extraPrincipal, 0);

    updateLoanPayment(db, id!, {
      paidOn: "2024-07-01",
      totalPaid: 1_080,
      principal: stored.principal,
      interest: stored.interest,
      escrow: stored.escrow,
      extraPrincipal: stored.extraPrincipal,
      balanceAfter: stored.balanceAfter,
      notes: "corrected total",
    });
    const resplit = db
      .prepare(
        `SELECT total_paid AS totalPaid, principal, extra_principal AS extraPrincipal, split_source AS splitSource, notes
         FROM real_estate_loan_payments WHERE id = ?`,
      )
      .get(id) as { totalPaid: number; principal: number; extraPrincipal: number; splitSource: string; notes: string };
    assert.equal(resplit.totalPaid, 1_080);
    assert.equal(resplit.splitSource, "computed");
    assert.equal(resplit.principal, 1_000);
    assert.equal(resplit.extraPrincipal, 80);
    assert.equal(resplit.notes, "corrected total");

    updateLoanPayment(db, id!, {
      paidOn: "2024-07-01",
      totalPaid: 1_080,
      principal: 900,
      interest: 0,
      escrow: 0,
      extraPrincipal: 0,
      balanceAfter: null,
      notes: "statement split",
    });
    const locked = db
      .prepare(`SELECT principal, extra_principal AS extraPrincipal, split_source AS splitSource FROM real_estate_loan_payments WHERE id = ?`)
      .get(id) as { principal: number; extraPrincipal: number; splitSource: string };
    assert.equal(locked.splitSource, "statement");
    assert.equal(locked.principal, 900);
    assert.equal(locked.extraPrincipal, 0);
  });
});

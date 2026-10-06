import type Database from "better-sqlite3";

import { nyYmd } from "@/lib/market/usEquitySession";
import { newId } from "@/lib/id";
import { hpiSeriesId, type ParsedHpi } from "@/lib/realEstate/hpi";
import { endOfMonth, monthOf } from "@/lib/realEstate/months";
import {
  displayBalance,
  latestBalance,
  loanDetailsComplete,
  projectBalances,
  type BalancePoint,
  type LoanTerms,
} from "@/lib/realEstate/loans";
import {
  buildMortgageView,
  mortgageTermsReady,
  recomputeComputedSplits,
  type StoredPayment,
  type MortgageTerms,
  type MortgageView,
  type SplitSource,
  type StatementAnchor,
} from "@/lib/realEstate/mortgage";
import { composeNetWorth, type NetWorthStrip } from "@/lib/realEstate/netWorth";
import { resolveOfficialSeries, type OfficialMonth, type ValuationInput, type ValueSource } from "@/lib/realEstate/resolveValue";

export type ValuationWrite = {
  propertyId: string;
  asOf: string;
  valueUsd: number;
  lowUsd: number | null;
  highUsd: number | null;
  source: ValueSource;
  sourceDetail: string;
  sourceUrl: string | null;
  notes: string | null;
};

export type LoanWrite = {
  propertyId: string;
  lender: string | null;
  originalPrincipal: number | null;
  annualRate: number | null;
  termMonths: number | null;
  startDate: string | null;
  monthlyPayment: number | null;
  /** Undefined leaves the stored value. Null clears escrow. */
  monthlyEscrow?: number | null;
  extraPrincipal?: number | null;
};

export type PaymentWrite = {
  paidOn: string;
  totalPaid: number;
  principal: number | null;
  interest: number | null;
  escrow: number | null;
  extraPrincipal: number | null;
  balanceAfter: number | null;
  notes: string | null;
};

const SOURCES = new Set<ValueSource>(["appraisal", "assessor", "manual_avm", "purchase"]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function currentMonth(now = new Date()): string {
  return nyYmd(now).slice(0, 7);
}

export function parseValuationPayload(body: unknown): { readings: ValuationWrite[] } | { error: string } {
  if (body == null || typeof body !== "object") return { error: "Expected a JSON object" };
  const record = body as Record<string, unknown>;
  const rawList = Array.isArray(record.readings) ? record.readings : [record];
  if (rawList.length === 0) return { error: "No readings" };
  if (rawList.length > 40) return { error: "At most 40 readings per call" };
  const readings: ValuationWrite[] = [];
  for (const raw of rawList) {
    const parsed = parseOneReading(raw);
    if ("error" in parsed) return parsed;
    readings.push(parsed);
  }
  return { readings };
}

function parseOneReading(raw: unknown): ValuationWrite | { error: string } {
  if (raw == null || typeof raw !== "object") return { error: "Each reading must be an object" };
  const row = raw as Record<string, unknown>;
  const propertyId = stringField(row.propertyId);
  const asOf = stringField(row.asOf);
  const source = stringField(row.source) as ValueSource;
  if (!propertyId) return { error: "propertyId is required" };
  if (!asOf || !ISO_DATE.test(asOf)) return { error: "asOf must be YYYY-MM-DD" };
  if (!SOURCES.has(source)) return { error: "source must be appraisal, assessor, manual_avm, or purchase" };
  const valueUsd = numberField(row.valueUsd);
  if (valueUsd == null || !(valueUsd > 0)) return { error: "valueUsd must be a positive number" };
  const lowUsd = numberField(row.lowUsd);
  const highUsd = numberField(row.highUsd);
  if (lowUsd != null && !(lowUsd > 0)) return { error: "lowUsd must be a positive number" };
  if (highUsd != null && !(highUsd > 0)) return { error: "highUsd must be a positive number" };
  let sourceDetail = stringField(row.sourceDetail).toLowerCase();
  if (source === "manual_avm" && !sourceDetail) return { error: "manual_avm readings need sourceDetail such as zillow, redfin, or realtor" };
  if (!sourceDetail) sourceDetail = source;
  const sourceUrl = stringField(row.sourceUrl) || null;
  if (sourceUrl && !/^https?:\/\//i.test(sourceUrl)) return { error: "sourceUrl must start with http:// or https://" };
  const notes = stringField(row.notes) || null;
  return { propertyId, asOf, valueUsd, lowUsd, highUsd, source, sourceDetail, sourceUrl, notes };
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberField(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

export function upsertValuations(db: Database.Database, readings: ValuationWrite[], now = new Date()): string[] {
  const known = new Set(
    (db.prepare(`SELECT id FROM real_estate_properties`).all() as Array<{ id: string }>).map((row) => row.id),
  );
  for (const reading of readings) {
    if (!known.has(reading.propertyId)) throw new Error(`Unknown property ${reading.propertyId}`);
  }
  const write = db.prepare(`
    INSERT INTO real_estate_valuations (
      id, property_id, as_of, value_usd, low_usd, high_usd, source, source_detail, source_url, is_anchor, notes, created_at
    ) VALUES (
      @id, @property_id, @as_of, @value_usd, @low_usd, @high_usd, @source, @source_detail, @source_url, @is_anchor, @notes, @created_at
    )
    ON CONFLICT(property_id, as_of, source, source_detail) DO UPDATE SET
      value_usd = excluded.value_usd,
      low_usd = excluded.low_usd,
      high_usd = excluded.high_usd,
      source_url = excluded.source_url,
      is_anchor = excluded.is_anchor,
      notes = excluded.notes
  `);
  const ids: string[] = [];
  const tx = db.transaction(() => {
    for (const reading of readings) {
      const id = newId("reval");
      write.run({
        id,
        property_id: reading.propertyId,
        as_of: reading.asOf,
        value_usd: reading.valueUsd,
        low_usd: reading.lowUsd,
        high_usd: reading.highUsd,
        source: reading.source,
        source_detail: reading.sourceDetail,
        source_url: reading.sourceUrl,
        is_anchor: reading.source === "appraisal" ? 1 : 0,
        notes: reading.notes,
        created_at: now.toISOString(),
      });
      const stored = db
        .prepare(
          `SELECT id FROM real_estate_valuations WHERE property_id = ? AND as_of = ? AND source = ? AND source_detail = ?`,
        )
        .get(reading.propertyId, reading.asOf, reading.source, reading.sourceDetail) as { id: string };
      ids.push(stored.id);
    }
  });
  tx();
  const month = currentMonth(now);
  for (const propertyId of new Set(readings.map((reading) => reading.propertyId))) {
    recomputeProperty(db, propertyId, month, now.toISOString());
  }
  return ids;
}

export function recomputeProperty(db: Database.Database, propertyId: string, throughMonth: string, computedAt: string): void {
  const property = db.prepare(`SELECT hpi_place_id AS hpiPlaceId FROM real_estate_properties WHERE id = ?`).get(propertyId) as
    | { hpiPlaceId: string }
    | undefined;
  if (!property) return;
  const readings = loadValuationInputs(db, propertyId);
  const hpi = db
    .prepare(`SELECT period, index_value AS "index" FROM hpi_observations WHERE series_id = ?`)
    .all(hpiSeriesId(property.hpiPlaceId)) as Array<{ period: string; index: number }>;
  const series = resolveOfficialSeries(readings, hpi, throughMonth);
  const insert = db.prepare(`
    INSERT INTO real_estate_value_points (
      property_id, month, value_usd, low_usd, high_usd, method, anchor_valuation_id, hpi_series, hpi_base, hpi_month, source_as_of, computed_at
    ) VALUES (
      @property_id, @month, @value_usd, @low_usd, @high_usd, @method, @anchor_valuation_id, @hpi_series, @hpi_base, @hpi_month, @source_as_of, @computed_at
    )
  `);
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM real_estate_value_points WHERE property_id = ?`).run(propertyId);
    for (const point of series) {
      insert.run({
        property_id: propertyId,
        month: point.month,
        value_usd: point.valueUsd,
        low_usd: point.lowUsd,
        high_usd: point.highUsd,
        method: point.method,
        anchor_valuation_id: point.anchorValuationId,
        hpi_series: hpiSeriesId(property.hpiPlaceId),
        hpi_base: point.hpiBase,
        hpi_month: point.hpiMonth,
        source_as_of: point.sourceAsOf,
        computed_at: computedAt,
      });
    }
  });
  tx();
}

export function recomputeAll(db: Database.Database, throughMonth: string, computedAt: string): void {
  const ids = db.prepare(`SELECT id FROM real_estate_properties WHERE status = 'active'`).all() as Array<{ id: string }>;
  for (const row of ids) recomputeProperty(db, row.id, throughMonth, computedAt);
}

export function replaceHpiObservations(db: Database.Database, rows: ParsedHpi[], fetchedAt: string): void {
  const seriesIds = [...new Set(rows.map((row) => row.seriesId))];
  const remove = db.prepare(`DELETE FROM hpi_observations WHERE series_id = ?`);
  const insert = db.prepare(`
    INSERT INTO hpi_observations (series_id, period, index_value, fetched_at)
    VALUES (@series_id, @period, @index_value, @fetched_at)
  `);
  const tx = db.transaction(() => {
    for (const seriesId of seriesIds) remove.run(seriesId);
    for (const row of rows) {
      insert.run({ series_id: row.seriesId, period: row.period, index_value: row.index, fetched_at: fetchedAt });
    }
  });
  tx();
}

export function listHpiPlaceIds(db: Database.Database): string[] {
  const rows = db
    .prepare(`SELECT DISTINCT hpi_place_id AS placeId FROM real_estate_properties WHERE status = 'active'`)
    .all() as Array<{ placeId: string }>;
  return rows.map((row) => row.placeId);
}

export function saveLoanTerms(db: Database.Database, write: LoanWrite, now = new Date()): void {
  const loan = db.prepare(`SELECT id, monthly_escrow AS monthlyEscrow, extra_principal AS extraPrincipal FROM real_estate_loans WHERE property_id = ?`).get(write.propertyId) as
    | { id: string; monthlyEscrow: number | null; extraPrincipal: number | null }
    | undefined;
  if (!loan) throw new Error("That property has no loan to update");
  if (write.originalPrincipal != null && !(write.originalPrincipal > 0)) throw new Error("originalPrincipal must be greater than zero");
  if (write.monthlyPayment != null && !(write.monthlyPayment > 0)) throw new Error("monthlyPayment must be greater than zero");
  if (write.termMonths != null && (!Number.isInteger(write.termMonths) || write.termMonths < 1 || write.termMonths > 480)) {
    throw new Error("termMonths must be a whole number from 1 to 480");
  }
  const extraPrincipal = write.extraPrincipal === undefined ? (loan.extraPrincipal ?? 0) : (write.extraPrincipal ?? 0);
  const monthlyEscrow = write.monthlyEscrow === undefined ? loan.monthlyEscrow : write.monthlyEscrow;
  if (!(extraPrincipal >= 0)) throw new Error("extraPrincipal must be zero or positive");
  if (monthlyEscrow != null && !(monthlyEscrow >= 0)) throw new Error("monthlyEscrow must be zero or positive");
  const complete = loanDetailsComplete({
    annualRate: write.annualRate,
    monthlyPayment: write.monthlyPayment,
    originalPrincipal: write.originalPrincipal,
    termMonths: write.termMonths,
    startDate: write.startDate,
  });
  db.prepare(`
    UPDATE real_estate_loans SET
      lender = @lender,
      original_principal = @original_principal,
      interest_rate = @interest_rate,
      term_months = @term_months,
      start_date = @start_date,
      monthly_payment = @monthly_payment,
      monthly_escrow = @monthly_escrow,
      extra_principal = @extra_principal,
      details_complete = @details_complete,
      updated_at = @updated_at
    WHERE id = @id
  `).run({
    id: loan.id,
    lender: write.lender,
    original_principal: write.originalPrincipal,
    interest_rate: write.annualRate,
    term_months: write.termMonths,
    start_date: write.startDate,
    monthly_payment: write.monthlyPayment,
    monthly_escrow: monthlyEscrow,
    extra_principal: extraPrincipal,
    details_complete: complete ? 1 : 0,
    updated_at: now.toISOString(),
  });
  resplitComputedPayments(db, loan.id, now);
  syncAmortization(db, currentMonth(now), now.toISOString());
}

export function saveStatementBalance(
  db: Database.Database,
  propertyId: string,
  asOf: string,
  balanceUsd: number,
  notes: string | null,
  now = new Date(),
): void {
  const loan = db.prepare(`SELECT id FROM real_estate_loans WHERE property_id = ?`).get(propertyId) as { id: string } | undefined;
  if (!loan) throw new Error("That property has no loan");
  if (!ISO_DATE.test(asOf)) throw new Error("asOf must be YYYY-MM-DD");
  if (!(balanceUsd >= 0)) throw new Error("balanceUsd must be zero or positive");
  db.prepare(`
    INSERT INTO real_estate_loan_balances (id, loan_id, as_of, balance_usd, source, notes, created_at)
    VALUES (@id, @loan_id, @as_of, @balance_usd, 'statement', @notes, @created_at)
    ON CONFLICT(loan_id, as_of, source) DO UPDATE SET
      balance_usd = excluded.balance_usd,
      notes = excluded.notes
  `).run({
    id: newId("rebal"),
    loan_id: loan.id,
    as_of: asOf,
    balance_usd: balanceUsd,
    notes,
    created_at: now.toISOString(),
  });
  syncAmortization(db, currentMonth(now), now.toISOString());
}

export function parsePaymentPayload(body: unknown): { propertyId: string; payments: PaymentWrite[] } | { error: string } {
  if (body == null || typeof body !== "object") return { error: "Expected a JSON object" };
  const record = body as Record<string, unknown>;
  const propertyId = stringField(record.propertyId);
  if (!propertyId) return { error: "propertyId is required" };
  const rawList = Array.isArray(record.payments) ? record.payments : [record];
  if (rawList.length === 0) return { error: "No payments" };
  if (rawList.length > 600) return { error: "At most 600 payments per call" };
  const payments: PaymentWrite[] = [];
  for (const raw of rawList) {
    const parsed = parseOnePayment(raw);
    if ("error" in parsed) return parsed;
    payments.push(parsed);
  }
  return { propertyId, payments };
}

function parseOnePayment(raw: unknown): PaymentWrite | { error: string } {
  if (raw == null || typeof raw !== "object") return { error: "Each payment must be an object" };
  const row = raw as Record<string, unknown>;
  const paidOn = stringField(row.paidOn);
  if (!ISO_DATE.test(paidOn)) return { error: "paidOn must be YYYY-MM-DD" };
  const totalPaid = numberField(row.totalPaid);
  if (totalPaid == null || totalPaid < 0) return { error: "totalPaid must be zero or positive" };
  const principal = numberField(row.principal);
  const interest = numberField(row.interest);
  const escrow = numberField(row.escrow);
  const extraPrincipal = numberField(row.extraPrincipal);
  const balanceAfter = numberField(row.balanceAfter);
  for (const [name, value] of [
    ["principal", principal],
    ["interest", interest],
    ["escrow", escrow],
    ["extraPrincipal", extraPrincipal],
    ["balanceAfter", balanceAfter],
  ] as const) {
    if (value != null && value < 0) return { error: `${name} must be zero or positive` };
  }
  if (!(totalPaid > 0) && !((principal ?? 0) + (interest ?? 0) + (extraPrincipal ?? 0) > 0)) {
    return { error: "A payment needs a total or a principal amount" };
  }
  const notes = stringField(row.notes) || null;
  if (notes && notes.length > 500) return { error: "notes must be 500 characters or fewer" };
  return { paidOn, totalPaid, principal, interest, escrow, extraPrincipal, balanceAfter, notes };
}

export function upsertLoanPayments(db: Database.Database, propertyId: string, payments: PaymentWrite[], now = new Date()): string[] {
  const loan = loanForProperty(db, propertyId);
  const ids = writePayments(db, loan.id, payments, now);
  resplitComputedPayments(db, loan.id, now);
  syncAmortization(db, currentMonth(now), now.toISOString());
  return ids;
}

export function updateLoanPayment(db: Database.Database, id: string, payment: PaymentWrite, now = new Date()): void {
  const existing = db.prepare(`SELECT loan_id AS loanId FROM real_estate_loan_payments WHERE id = ?`).get(id) as { loanId: string } | undefined;
  if (!existing) throw new Error("Payment not found");
  const clash = db
    .prepare(`SELECT id FROM real_estate_loan_payments WHERE loan_id = ? AND paid_on = ? AND id <> ?`)
    .get(existing.loanId, payment.paidOn, id) as { id: string } | undefined;
  if (clash) throw new Error("A payment is already logged on that date");
  const splitSource: SplitSource = payment.principal != null && payment.interest != null ? "statement" : "computed";
  if (splitSource === "computed" && !loadMortgageTerms(db, existing.loanId)) {
    throw new Error("Enter original principal, rate, term, first payment date, and the monthly principal and interest before a total-only payment can be split");
  }
  db.prepare(`
    UPDATE real_estate_loan_payments SET
      paid_on = @paid_on,
      total_paid = @total_paid,
      principal = @principal,
      interest = @interest,
      escrow = @escrow,
      extra_principal = @extra_principal,
      balance_after = @balance_after,
      notes = @notes,
      split_source = @split_source,
      updated_at = @updated_at
    WHERE id = @id
  `).run(paymentParams(id, existing.loanId, payment, splitSource, now));
  resplitComputedPayments(db, existing.loanId, now);
  syncAmortization(db, currentMonth(now), now.toISOString());
}

export function deleteLoanPayment(db: Database.Database, id: string, now = new Date()): void {
  const existing = db.prepare(`SELECT loan_id AS loanId FROM real_estate_loan_payments WHERE id = ?`).get(id) as { loanId: string } | undefined;
  if (!existing) throw new Error("Payment not found");
  db.prepare(`DELETE FROM real_estate_loan_payments WHERE id = ?`).run(id);
  resplitComputedPayments(db, existing.loanId, now);
  syncAmortization(db, currentMonth(now), now.toISOString());
}

function loanForProperty(db: Database.Database, propertyId: string): { id: string } {
  const loan = db.prepare(`SELECT id FROM real_estate_loans WHERE property_id = ?`).get(propertyId) as { id: string } | undefined;
  if (!loan) throw new Error("That property has no loan");
  return loan;
}

function writePayments(db: Database.Database, loanId: string, payments: PaymentWrite[], now: Date): string[] {
  const terms = loadMortgageTerms(db, loanId);
  const insert = db.prepare(`
    INSERT INTO real_estate_loan_payments (
      id, loan_id, paid_on, total_paid, principal, interest, escrow, extra_principal, balance_after, notes, split_source, created_at, updated_at
    ) VALUES (
      @id, @loan_id, @paid_on, @total_paid, @principal, @interest, @escrow, @extra_principal, @balance_after, @notes, @split_source, @created_at, @updated_at
    )
    ON CONFLICT(loan_id, paid_on) DO UPDATE SET
      total_paid = excluded.total_paid,
      principal = excluded.principal,
      interest = excluded.interest,
      escrow = excluded.escrow,
      extra_principal = excluded.extra_principal,
      balance_after = excluded.balance_after,
      notes = excluded.notes,
      split_source = excluded.split_source,
      updated_at = excluded.updated_at
    RETURNING id
  `);
  const ids: string[] = [];
  const tx = db.transaction(() => {
    for (const payment of payments) {
      const splitSource: SplitSource = payment.principal != null && payment.interest != null ? "statement" : "computed";
      if (splitSource === "computed" && !terms) {
        throw new Error("Enter original principal, rate, term, first payment date, and the monthly principal and interest before a total-only payment can be split");
      }
      const row = insert.get(paymentParams(newId("repay"), loanId, payment, splitSource, now)) as { id: string };
      ids.push(row.id);
    }
  });
  tx();
  return ids;
}

function paymentParams(id: string, loanId: string, payment: PaymentWrite, splitSource: SplitSource, now: Date) {
  return {
    id,
    loan_id: loanId,
    paid_on: payment.paidOn,
    total_paid: payment.totalPaid,
    principal: splitSource === "statement" ? payment.principal : null,
    interest: splitSource === "statement" ? payment.interest : null,
    escrow: payment.escrow,
    extra_principal: splitSource === "statement" ? (payment.extraPrincipal ?? 0) : null,
    balance_after: payment.balanceAfter,
    notes: payment.notes,
    split_source: splitSource,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
  };
}

function resplitComputedPayments(db: Database.Database, loanId: string, now: Date): void {
  const terms = loadMortgageTerms(db, loanId);
  if (!terms) return;
  const payments = loadPaymentRows(db, loanId);
  const statements = loadStatementAnchors(db, loanId);
  const updates = recomputeComputedSplits(terms, payments, statements);
  const update = db.prepare(`
    UPDATE real_estate_loan_payments SET
      principal = @principal,
      interest = @interest,
      escrow = @escrow,
      extra_principal = @extra_principal,
      balance_after = @balance_after,
      split_source = @split_source,
      updated_at = @updated_at
    WHERE id = @id
  `);
  const tx = db.transaction(() => {
    for (const row of updates) {
      update.run({
        id: row.id,
        principal: row.principal,
        interest: row.interest,
        escrow: row.escrow,
        extra_principal: row.extraPrincipal,
        balance_after: row.balanceAfter,
        split_source: row.splitSource,
        updated_at: now.toISOString(),
      });
    }
  });
  tx();
}

function loadMortgageTerms(db: Database.Database, loanId: string): MortgageTerms | null {
  const row = db
    .prepare(
      `SELECT original_principal AS originalPrincipal, interest_rate AS annualRate, term_months AS termMonths,
              start_date AS firstPaymentDate, monthly_payment AS monthlyPayment, monthly_escrow AS monthlyEscrow,
              extra_principal AS extraPrincipal
       FROM real_estate_loans WHERE id = ?`,
    )
    .get(loanId) as
    | {
        originalPrincipal: number | null;
        annualRate: number | null;
        termMonths: number | null;
        firstPaymentDate: string | null;
        monthlyPayment: number | null;
        monthlyEscrow: number | null;
        extraPrincipal: number | null;
      }
    | undefined;
  if (!row) return null;
  const terms: MortgageTerms = {
    originalPrincipal: row.originalPrincipal ?? 0,
    annualRate: row.annualRate ?? -1,
    termMonths: row.termMonths ?? 0,
    firstPaymentDate: row.firstPaymentDate ?? "",
    monthlyPayment: row.monthlyPayment ?? 0,
    monthlyEscrow: row.monthlyEscrow ?? 0,
    extraPrincipal: row.extraPrincipal ?? 0,
  };
  return mortgageTermsReady(terms) ? terms : null;
}

function loadPaymentRows(db: Database.Database, loanId: string): StoredPayment[] {
  return db
    .prepare(
      `SELECT id, paid_on AS paidOn, total_paid AS totalPaid, principal, interest, escrow,
              extra_principal AS extraPrincipal, balance_after AS balanceAfter, notes, split_source AS splitSource
       FROM real_estate_loan_payments WHERE loan_id = ? ORDER BY paid_on, id`,
    )
    .all(loanId) as StoredPayment[];
}

function loadStatementAnchors(db: Database.Database, loanId: string): StatementAnchor[] {
  return db
    .prepare(
      `SELECT as_of AS asOf, balance_usd AS balanceUsd FROM real_estate_loan_balances
       WHERE loan_id = ? AND source = 'statement' ORDER BY as_of`,
    )
    .all(loanId) as StatementAnchor[];
}

export function syncAmortization(db: Database.Database, throughMonth: string, computedAt: string): void {
  const loans = db
    .prepare(
      `SELECT id, interest_rate AS annualRate, monthly_payment AS monthlyPayment, original_principal AS originalPrincipal,
              term_months AS termMonths, start_date AS startDate, details_complete AS detailsComplete
       FROM real_estate_loans`,
    )
    .all() as Array<{
    id: string;
    annualRate: number | null;
    monthlyPayment: number | null;
    originalPrincipal: number | null;
    termMonths: number | null;
    startDate: string | null;
    detailsComplete: number;
  }>;
  const remove = db.prepare(`DELETE FROM real_estate_loan_balances WHERE loan_id = ? AND source = 'amortization'`);
  const insert = db.prepare(`
    INSERT INTO real_estate_loan_balances (id, loan_id, as_of, balance_usd, source, notes, created_at)
    VALUES (@id, @loan_id, @as_of, @balance_usd, 'amortization', NULL, @created_at)
  `);
  const tx = db.transaction(() => {
    for (const loan of loans) {
      remove.run(loan.id);
      const terms: LoanTerms = { ...loan, detailsComplete: loan.detailsComplete === 1 };
      if (!terms.detailsComplete) continue;
      const manuals = loadBalances(db, loan.id).filter((point) => point.source !== "amortization");
      for (const point of projectBalances(terms, manuals, throughMonth)) {
        if (point.source !== "amortization") continue;
        insert.run({
          id: newId("rebal"),
          loan_id: loan.id,
          as_of: point.asOf,
          balance_usd: point.balanceUsd,
          created_at: computedAt,
        });
      }
    }
  });
  tx();
}

export type DashboardReading = ValuationInput & {
  propertyId: string;
  sourceUrl: string | null;
  notes: string | null;
};

export type DashboardProperty = {
  id: string;
  label: string;
  street: string;
  city: string;
  state: string;
  postalCode: string | null;
  mailingStreet: string | null;
  ownerName: string | null;
  caveat: string | null;
  hpiPlaceId: string;
  hpiLatestPeriod: string | null;
  parcels: Array<{ id: string; apn: string; county: string; state: string; role: string; street: string | null }>;
  loan: {
    id: string;
    balanceUsd: number;
    balanceAsOf: string | null;
    balanceSource: string | null;
    detailsComplete: boolean;
    lender: string | null;
    annualRate: number | null;
    termMonths: number | null;
    startDate: string | null;
    monthlyPayment: number | null;
    monthlyEscrow: number | null;
    extraPrincipal: number;
    notes: string | null;
    mortgage: MortgageView | null;
  } | null;
  readings: DashboardReading[];
  series: Array<OfficialMonth & { loanBalance: number; equity: number }>;
  officialValue: number | null;
  loanBalance: number;
};

export function loadDashboard(db: Database.Database, investable: number, throughMonth: string): {
  netWorth: NetWorthStrip;
  properties: DashboardProperty[];
  hpiFetchedAt: string | null;
} {
  const today = nyYmd(new Date());
  const asOf = monthOf(today) === throughMonth ? today : endOfMonth(throughMonth);
  const properties = db
    .prepare(
      `SELECT id, label, street, city, state, postal_code AS postalCode, mailing_street AS mailingStreet,
              owner_name AS ownerName, estimate_caveat AS estimateCaveat, hpi_place_id AS hpiPlaceId
       FROM real_estate_properties WHERE flavor = 'main' AND status = 'active' ORDER BY label`,
    )
    .all() as Array<{
    id: string;
    label: string;
    street: string;
    city: string;
    state: string;
    postalCode: string | null;
    mailingStreet: string | null;
    ownerName: string | null;
    estimateCaveat: string | null;
    hpiPlaceId: string;
  }>;

  const built: DashboardProperty[] = properties.map((property) => {
    const readings = loadReadings(db, property.id);
    const hasAppraisal = readings.some((reading) => reading.source === "appraisal");
    const loanRow = db
      .prepare(
        `SELECT id, lender, interest_rate AS annualRate, monthly_payment AS monthlyPayment,
                original_principal AS originalPrincipal, term_months AS termMonths, start_date AS startDate,
                monthly_escrow AS monthlyEscrow, extra_principal AS extraPrincipal,
                details_complete AS detailsComplete
         FROM real_estate_loans WHERE property_id = ?`,
      )
      .get(property.id) as
      | {
          id: string;
          lender: string | null;
          annualRate: number | null;
          monthlyPayment: number | null;
          originalPrincipal: number | null;
          termMonths: number | null;
          startDate: string | null;
          monthlyEscrow: number | null;
          extraPrincipal: number | null;
          detailsComplete: number;
        }
      | undefined;
    const manuals = loanRow ? loadBalances(db, loanRow.id).filter((point) => point.source !== "amortization") : [];
    const terms: LoanTerms | null = loanRow
      ? {
          detailsComplete: loanRow.detailsComplete === 1,
          annualRate: loanRow.annualRate,
          monthlyPayment: loanRow.monthlyPayment,
          originalPrincipal: loanRow.originalPrincipal,
          termMonths: loanRow.termMonths,
          startDate: loanRow.startDate,
        }
      : null;
    const balances = terms ? projectBalances(terms, manuals, throughMonth) : manuals;
    const points = db
      .prepare(
        `SELECT month, value_usd AS valueUsd, low_usd AS lowUsd, high_usd AS highUsd, method,
                anchor_valuation_id AS anchorValuationId, hpi_base AS hpiBase, hpi_month AS hpiMonth, source_as_of AS sourceAsOf
         FROM real_estate_value_points WHERE property_id = ? AND month <= ? ORDER BY month`,
      )
      .all(property.id, throughMonth) as OfficialMonth[];
    const official = [...points].reverse().find((point) => point.month <= throughMonth) ?? null;
    const purchase = readings.find((reading) => reading.source === "purchase");
    const ownerEstimate = manuals
      .filter((point) => point.source === "owner_estimate")
      .sort((a, b) => a.asOf.localeCompare(b.asOf))
      .at(-1);
    const mortgage = loanRow
      ? buildMortgageView({
          asOf,
          lender: loanRow.lender,
          terms: loadMortgageTerms(db, loanRow.id),
          payments: loadPaymentRows(db, loanRow.id),
          statements: manuals
            .filter((point) => point.source === "statement")
            .map((point) => ({ asOf: point.asOf, balanceUsd: point.balanceUsd })),
          ownerEstimate: ownerEstimate ? { asOf: ownerEstimate.asOf, balanceUsd: ownerEstimate.balanceUsd } : null,
          officialValue: official?.valueUsd ?? null,
          official: points.map((point) => ({ month: point.month, valueUsd: point.valueUsd })),
          purchaseMonth: purchase ? monthOf(purchase.asOf) : null,
        })
      : null;
    const balanceAt = new Map((mortgage?.equitySeries ?? []).filter((point) => point.balance != null).map((point) => [point.month, point.balance as number]));
    const series = points.map((point) => {
      const loanBalance = mortgage?.ready
        ? (balanceAt.get(point.month) ?? mortgage.balanceUsd)
        : displayBalance(balances, point.month, terms?.detailsComplete === true);
      return { ...point, loanBalance, equity: point.valueUsd - loanBalance };
    });
    const latestBal = balances
      .filter((point) => point.asOf <= asOf)
      .sort((a, b) => a.asOf.localeCompare(b.asOf))
      .at(-1);
    const hpiLatest = db
      .prepare(`SELECT MAX(period) AS period FROM hpi_observations WHERE series_id = ?`)
      .get(hpiSeriesId(property.hpiPlaceId)) as { period: string | null };
    return {
      id: property.id,
      label: property.label,
      street: property.street,
      city: property.city,
      state: property.state,
      postalCode: property.postalCode,
      mailingStreet: property.mailingStreet,
      ownerName: property.ownerName,
      caveat: hasAppraisal ? null : property.estimateCaveat,
      hpiPlaceId: property.hpiPlaceId,
      hpiLatestPeriod: hpiLatest.period,
      parcels: db
        .prepare(
          `SELECT id, apn, county, state, role, street FROM real_estate_parcels WHERE property_id = ? ORDER BY role, apn`,
        )
        .all(property.id) as DashboardProperty["parcels"],
      loan: loanRow
        ? {
            id: loanRow.id,
            balanceUsd: mortgage?.ready ? mortgage.balanceUsd : latestBalance(balances, asOf),
            balanceAsOf: mortgage?.ready ? mortgage.balanceAsOf : (latestBal?.asOf ?? null),
            balanceSource: mortgage?.ready ? mortgage.balanceSource : (latestBal?.source ?? null),
            detailsComplete: loanRow.detailsComplete === 1,
            lender: loanRow.lender,
            annualRate: loanRow.annualRate,
            termMonths: loanRow.termMonths,
            startDate: loanRow.startDate,
            monthlyPayment: loanRow.monthlyPayment,
            monthlyEscrow: loanRow.monthlyEscrow,
            extraPrincipal: loanRow.extraPrincipal ?? 0,
            notes: mortgage?.balanceSource === "owner_estimate" && ownerEstimate ? balanceNote(db, loanRow.id, ownerEstimate) : null,
            mortgage,
          }
        : null,
      readings,
      series,
      officialValue: official?.valueUsd ?? null,
      loanBalance: mortgage?.ready ? mortgage.balanceUsd : latestBalance(balances, asOf),
    };
  });

  const fetched = db.prepare(`SELECT MAX(fetched_at) AS fetchedAt FROM hpi_observations`).get() as { fetchedAt: string | null };
  return {
    netWorth: composeNetWorth(
      investable,
      built.map((property) => ({ officialValue: property.officialValue, loanBalance: property.loanBalance })),
    ),
    properties: built,
    hpiFetchedAt: fetched.fetchedAt,
  };
}

function balanceNote(db: Database.Database, loanId: string, point: BalancePoint): string | null {
  const row = db
    .prepare(`SELECT notes FROM real_estate_loan_balances WHERE loan_id = ? AND as_of = ? AND source = ?`)
    .get(loanId, point.asOf, point.source) as { notes: string | null } | undefined;
  return row?.notes ?? null;
}

function loadValuationInputs(db: Database.Database, propertyId: string): ValuationInput[] {
  return db
    .prepare(
      `SELECT id, as_of AS asOf, value_usd AS valueUsd, low_usd AS lowUsd, high_usd AS highUsd, source, source_detail AS sourceDetail
       FROM real_estate_valuations WHERE property_id = ?`,
    )
    .all(propertyId) as ValuationInput[];
}

function loadReadings(db: Database.Database, propertyId: string): DashboardReading[] {
  return db
    .prepare(
      `SELECT id, property_id AS propertyId, as_of AS asOf, value_usd AS valueUsd, low_usd AS lowUsd, high_usd AS highUsd,
              source, source_detail AS sourceDetail, source_url AS sourceUrl, notes
       FROM real_estate_valuations WHERE property_id = ? ORDER BY as_of, source, source_detail`,
    )
    .all(propertyId) as DashboardReading[];
}

function loadBalances(db: Database.Database, loanId: string): BalancePoint[] {
  return db
    .prepare(
      `SELECT as_of AS asOf, balance_usd AS balanceUsd, source FROM real_estate_loan_balances WHERE loan_id = ? ORDER BY as_of`,
    )
    .all(loanId) as BalancePoint[];
}

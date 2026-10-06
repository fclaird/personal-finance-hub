import { addMonths, endOfMonth, monthOf, monthRange, nextMonth } from "@/lib/realEstate/months";

export type BalanceSource = "statement" | "amortization" | "owner_estimate";
export type SplitSource = "statement" | "computed";

export type MortgageTerms = {
  originalPrincipal: number;
  annualRate: number;
  termMonths: number;
  firstPaymentDate: string;
  monthlyPayment: number;
  monthlyEscrow: number;
  extraPrincipal: number;
};

export type PaymentDraft = {
  paidOn: string;
  totalPaid: number;
  principal: number | null;
  interest: number | null;
  escrow: number | null;
  extraPrincipal: number | null;
  balanceAfter: number | null;
  notes: string | null;
  splitSource?: SplitSource | null;
};

export type StatementAnchor = { asOf: string; balanceUsd: number };

export type AppliedPayment = {
  paidOn: string;
  totalPaid: number;
  principal: number;
  interest: number;
  escrow: number;
  extraPrincipal: number;
  balanceBefore: number;
  balanceAfter: number;
  splitSource: SplitSource;
  notes: string | null;
};

export type ResolvedBalance = {
  balanceUsd: number;
  asOf: string;
  source: BalanceSource;
};

export type BalanceChartPoint = {
  month: string;
  actual: number | null;
  actualProjected: number | null;
  scheduled: number | null;
  scheduledProjected: number | null;
};

export type EquityChartPoint = {
  month: string;
  value: number | null;
  balance: number | null;
  equity: number | null;
};

export type PaymentBar = { month: string; principal: number; interest: number; extra: number };

export type StoredPayment = PaymentDraft & { id: string; splitSource: SplitSource };

export type MortgageView = {
  ready: boolean;
  lender: string | null;
  originalPrincipal: number | null;
  annualRate: number | null;
  termMonths: number | null;
  firstPaymentDate: string | null;
  monthlyPayment: number | null;
  monthlyEscrow: number | null;
  extraPrincipal: number;
  balanceUsd: number;
  balanceAsOf: string | null;
  balanceSource: BalanceSource;
  equityUsd: number | null;
  payoffWithExtra: string | null;
  payoffWithout: string | null;
  monthsSaved: number | null;
  interestSaved: number | null;
  interestPaidYtd: number;
  interestPaidToDate: number;
  balanceSeries: BalanceChartPoint[];
  equitySeries: EquityChartPoint[];
  paymentSeries: PaymentBar[];
  payments: StoredPayment[];
};

type MonthStep = { interest: number; principal: number; extraApplied: number; balance: number };

export function roundCents(value: number): number {
  return Math.round(value * 100) / 100;
}

export function mortgageTermsReady(terms: Partial<MortgageTerms> | null | undefined): terms is MortgageTerms {
  if (!terms) return false;
  return (
    terms.originalPrincipal != null &&
    terms.originalPrincipal > 0 &&
    terms.annualRate != null &&
    terms.annualRate >= 0 &&
    terms.termMonths != null &&
    terms.termMonths > 0 &&
    Boolean(terms.firstPaymentDate) &&
    terms.monthlyPayment != null &&
    terms.monthlyPayment > 0 &&
    (terms.extraPrincipal ?? 0) >= 0 &&
    (terms.monthlyEscrow ?? 0) >= 0
  );
}

/** One month of a fixed payment. Extra principal is applied after interest. */
export function stepMonth(balance: number, annualRate: number, payment: number, extra: number): MonthStep {
  const start = roundCents(Math.max(0, balance));
  if (start === 0) return { interest: 0, principal: 0, extraApplied: 0, balance: 0 };
  const interest = roundCents(start * (annualRate / 12));
  const pi = roundCents(Math.max(0, payment));
  const extraCap = roundCents(Math.max(0, extra));
  const due = roundCents(start + interest);
  if (pi >= due) return { interest, principal: start, extraApplied: 0, balance: 0 };
  if (roundCents(pi + extraCap) >= due) {
    return { interest, principal: start, extraApplied: roundCents(due - pi), balance: 0 };
  }
  const unpaidInterest = roundCents(Math.max(0, interest - pi));
  const principal = roundCents(Math.min(start, Math.max(0, pi - interest)));
  const extraApplied = roundCents(Math.min(extraCap, roundCents(start - principal)));
  return {
    interest,
    principal,
    extraApplied,
    balance: roundCents(start + unpaidInterest - principal - extraApplied),
  };
}

function hasComponents(draft: PaymentDraft): boolean {
  return draft.principal != null && draft.interest != null;
}

/**
 * Split a payment. Components already on the draft are kept and marked statement
 * when that is how they were saved. A total-only draft is split from the balance
 * and marked computed. Planned escrow is taken only when the total covers
 * principal-and-interest plus that escrow.
 */
export function applyPayment(balanceBefore: number, terms: MortgageTerms, draft: PaymentDraft): AppliedPayment {
  const before = roundCents(Math.max(0, balanceBefore));
  if (hasComponents(draft)) {
    const principal = roundCents(Math.max(0, draft.principal ?? 0));
    const interest = roundCents(Math.max(0, draft.interest ?? 0));
    const escrow = roundCents(Math.max(0, draft.escrow ?? 0));
    const extraPrincipal = roundCents(Math.max(0, draft.extraPrincipal ?? 0));
    const computedAfter = roundCents(Math.max(0, before - principal - extraPrincipal));
    return {
      paidOn: draft.paidOn,
      totalPaid: roundCents(draft.totalPaid),
      principal,
      interest,
      escrow,
      extraPrincipal,
      balanceBefore: before,
      balanceAfter: draft.balanceAfter != null ? roundCents(Math.max(0, draft.balanceAfter)) : computedAfter,
      splitSource: draft.splitSource === "computed" ? "computed" : "statement",
      notes: draft.notes,
    };
  }
  const escrowPlanned = roundCents(Math.max(0, terms.monthlyEscrow));
  const required = roundCents(terms.monthlyPayment + escrowPlanned);
  let escrow = 0;
  let rest = roundCents(Math.max(0, draft.totalPaid));
  if (escrowPlanned > 0 && rest + 0.001 >= required) {
    escrow = escrowPlanned;
    rest = roundCents(rest - escrow);
  }
  const interestDue = roundCents(before * (terms.annualRate / 12));
  const interest = roundCents(Math.min(rest, interestDue));
  let remaining = roundCents(rest - interest);
  const scheduledPrincipal = roundCents(Math.min(before, Math.max(0, terms.monthlyPayment - interestDue)));
  const principal = roundCents(Math.min(remaining, scheduledPrincipal));
  remaining = roundCents(remaining - principal);
  const extraPrincipal = roundCents(Math.min(remaining, roundCents(before - principal)));
  const computedAfter = roundCents(Math.max(0, before - principal - extraPrincipal));
  return {
    paidOn: draft.paidOn,
    totalPaid: roundCents(draft.totalPaid),
    principal,
    interest,
    escrow,
    extraPrincipal,
    balanceBefore: before,
    balanceAfter: draft.balanceAfter != null ? roundCents(Math.max(0, draft.balanceAfter)) : computedAfter,
    splitSource: "computed",
    notes: draft.notes,
  };
}

function latestStatement(payments: PaymentDraft[], statements: StatementAnchor[], asOf: string): StatementAnchor | null {
  const anchors: StatementAnchor[] = [
    ...statements.filter((row) => row.asOf <= asOf),
    ...payments
      .filter((row) => row.balanceAfter != null && row.paidOn <= asOf)
      .map((row) => ({ asOf: row.paidOn, balanceUsd: row.balanceAfter as number })),
  ];
  anchors.sort((a, b) => a.asOf.localeCompare(b.asOf));
  return anchors.at(-1) ?? null;
}

type MonthEvent =
  | { date: string; kind: "payment"; payment: PaymentDraft }
  | { date: string; kind: "statement"; balanceUsd: number }
  | { date: string; kind: "due" };

function eventsInMonth(
  month: string,
  due: string | null,
  allowSchedule: boolean,
  payments: PaymentDraft[],
  statements: StatementAnchor[],
  asOf: string,
): MonthEvent[] {
  const events: MonthEvent[] = [];
  for (const payment of payments) {
    if (monthOf(payment.paidOn) === month && payment.paidOn <= asOf) events.push({ date: payment.paidOn, kind: "payment", payment });
  }
  for (const statement of statements) {
    if (monthOf(statement.asOf) === month && statement.asOf <= asOf) {
      events.push({ date: statement.asOf, kind: "statement", balanceUsd: statement.balanceUsd });
    }
  }
  if (allowSchedule && due && monthOf(due) === month && !events.some((event) => event.kind === "payment")) {
    events.push({ date: due, kind: "due" });
  }
  const rank = { payment: 0, statement: 1, due: 2 };
  events.sort((a, b) => a.date.localeCompare(b.date) || rank[a.kind] - rank[b.kind]);
  return events;
}

export type ActualWalk = {
  months: Array<{ month: string; balance: number }>;
  balance: number;
  asOf: string;
  source: BalanceSource;
};

/**
 * Balance path from the original principal.
 * Logged payments replace the scheduled draft in their month.
 * After the latest statement, only later logged payments move the balance.
 */
export function walkActual(
  terms: MortgageTerms,
  payments: PaymentDraft[],
  statements: StatementAnchor[],
  asOf: string,
  purchaseMonth: string | null,
): ActualWalk {
  const statement = latestStatement(payments, statements, asOf);
  const firstMonth = monthOf(terms.firstPaymentDate);
  const start = purchaseMonth && purchaseMonth < firstMonth ? purchaseMonth : firstMonth;
  const end = monthOf(asOf);
  let balance = roundCents(terms.originalPrincipal);
  const months: Array<{ month: string; balance: number }> = [];
  const monthsToCover = start <= end ? monthRange(start, end) : [start];

  for (const month of monthsToCover) {
    if (month < firstMonth) {
      for (const event of eventsInMonth(month, null, false, payments, statements, asOf)) {
        balance = applyEvent(balance, terms, event);
      }
      months.push({ month, balance });
      continue;
    }
    const offset = monthIndex(firstMonth, month);
    const due = addMonths(terms.firstPaymentDate, offset);
    const allowSchedule = due <= asOf && (statement == null || due <= statement.asOf);
    if (due <= asOf || eventsInMonth(month, null, false, payments, statements, asOf).length > 0) {
      for (const event of eventsInMonth(month, due, allowSchedule, payments, statements, asOf)) {
        balance = applyEvent(balance, terms, event);
      }
    }
    months.push({ month, balance });
  }

  const laterPayment = statement ? payments.some((row) => row.paidOn > statement.asOf && row.paidOn <= asOf) : false;
  if (statement && !laterPayment) {
    const snapped = roundCents(statement.balanceUsd);
    for (const point of months) {
      if (point.month >= monthOf(statement.asOf)) point.balance = snapped;
    }
    return { months, balance: snapped, asOf: statement.asOf, source: "statement" };
  }
  return { months, balance, asOf, source: "amortization" };
}

function applyEvent(balance: number, terms: MortgageTerms, event: MonthEvent): number {
  if (event.kind === "statement") return roundCents(Math.max(0, event.balanceUsd));
  if (event.kind === "payment") return applyPayment(balance, terms, event.payment).balanceAfter;
  return stepMonth(balance, terms.annualRate, terms.monthlyPayment, terms.extraPrincipal).balance;
}

function monthIndex(start: string, month: string): number {
  const years = Number(month.slice(0, 4)) - Number(start.slice(0, 4));
  return years * 12 + (Number(month.slice(5, 7)) - Number(start.slice(5, 7)));
}

export function resolveMortgageBalance(input: {
  asOf: string;
  terms: MortgageTerms | null;
  payments: PaymentDraft[];
  statements: StatementAnchor[];
  ownerEstimate: { asOf: string; balanceUsd: number } | null;
  purchaseMonth?: string | null;
}): ResolvedBalance {
  if (!mortgageTermsReady(input.terms)) {
    if (input.ownerEstimate) {
      return { balanceUsd: roundCents(input.ownerEstimate.balanceUsd), asOf: input.ownerEstimate.asOf, source: "owner_estimate" };
    }
    return { balanceUsd: 0, asOf: input.asOf, source: "owner_estimate" };
  }
  const walked = walkActual(input.terms, input.payments, input.statements, input.asOf, input.purchaseMonth ?? null);
  return { balanceUsd: walked.balance, asOf: walked.asOf, source: walked.source };
}

export type PayoffPath = { date: string; months: number; interest: number };

/** Next payment date strictly after asOf, counting asOf itself as already reflected in the balance. */
export function nextDueAfter(firstPaymentDate: string, asOf: string): string {
  let due = firstPaymentDate;
  let guard = 0;
  while (due <= asOf && guard < 1200) {
    guard += 1;
    due = addMonths(firstPaymentDate, guard);
  }
  return due;
}

export function projectPayoff(balance: number, terms: MortgageTerms, extra: number, asOf: string): PayoffPath | null {
  let remaining = roundCents(Math.max(0, balance));
  if (remaining === 0) return { date: asOf, months: 0, interest: 0 };
  let due = nextDueAfter(terms.firstPaymentDate, asOf);
  let interest = 0;
  const max = Math.max(terms.termMonths + 120, 1);
  for (let months = 1; months <= max; months += 1) {
    const step = stepMonth(remaining, terms.annualRate, terms.monthlyPayment, extra);
    if (roundCents(step.principal + step.extraApplied) <= 0) return null;
    interest = roundCents(interest + step.interest);
    remaining = step.balance;
    if (remaining === 0) return { date: due, months, interest };
    due = addMonths(due, 1);
  }
  return null;
}

function scheduledBalances(terms: MortgageTerms, asOf: string, purchaseMonth: string | null): Array<{ month: string; balance: number }> {
  const firstMonth = monthOf(terms.firstPaymentDate);
  const start = purchaseMonth && purchaseMonth < firstMonth ? purchaseMonth : firstMonth;
  let balance = roundCents(terms.originalPrincipal);
  const out: Array<{ month: string; balance: number }> = [];
  let month = start;
  let offset = 0;
  const horizon = addMonths(terms.firstPaymentDate, terms.termMonths + 1).slice(0, 7);
  while (month <= horizon && out.length < terms.termMonths + 24) {
    if (month >= firstMonth) {
      const due = addMonths(terms.firstPaymentDate, offset);
      if (monthOf(due) === month) {
        balance = stepMonth(balance, terms.annualRate, terms.monthlyPayment, 0).balance;
        offset += 1;
      }
    }
    out.push({ month, balance });
    if (balance === 0 && month >= monthOf(asOf)) break;
    month = nextMonth(month);
  }
  return out;
}

function projectActual(balance: number, terms: MortgageTerms, asOf: string): Array<{ month: string; balance: number }> {
  const current = monthOf(asOf);
  const points = [{ month: current, balance: roundCents(balance) }];
  let remaining = roundCents(Math.max(0, balance));
  if (remaining === 0) return points;
  let due = nextDueAfter(terms.firstPaymentDate, asOf);
  for (let guard = 0; guard < terms.termMonths + 120 && remaining > 0; guard += 1) {
    const step = stepMonth(remaining, terms.annualRate, terms.monthlyPayment, terms.extraPrincipal);
    if (roundCents(step.principal + step.extraApplied) <= 0) break;
    remaining = step.balance;
    points.push({ month: monthOf(due), balance: remaining });
    due = addMonths(due, 1);
  }
  return points;
}

export function paymentBars(payments: PaymentDraft[]): PaymentBar[] {
  const byMonth = new Map<string, PaymentBar>();
  for (const payment of [...payments].sort((a, b) => a.paidOn.localeCompare(b.paidOn))) {
    const month = monthOf(payment.paidOn);
    const bar = byMonth.get(month) ?? { month, principal: 0, interest: 0, extra: 0 };
    bar.principal = roundCents(bar.principal + (payment.principal ?? 0));
    bar.interest = roundCents(bar.interest + (payment.interest ?? 0));
    bar.extra = roundCents(bar.extra + (payment.extraPrincipal ?? 0));
    byMonth.set(month, bar);
  }
  return [...byMonth.values()];
}

export function interestPaid(payments: PaymentDraft[], asOf: string): { toDate: number; ytd: number } {
  const year = asOf.slice(0, 4);
  let toDate = 0;
  let ytd = 0;
  for (const payment of payments) {
    if (payment.paidOn > asOf) continue;
    const interest = payment.interest ?? 0;
    toDate = roundCents(toDate + interest);
    if (payment.paidOn.slice(0, 4) === year) ytd = roundCents(ytd + interest);
  }
  return { toDate, ytd };
}

export function buildBalanceSeries(
  terms: MortgageTerms,
  walked: ActualWalk,
  asOf: string,
  purchaseMonth: string | null,
): BalanceChartPoint[] {
  const current = monthOf(asOf);
  const scheduled = scheduledBalances(terms, asOf, purchaseMonth);
  const projected = projectActual(walked.balance, terms, asOf);
  const actual = new Map(walked.months.map((point) => [point.month, point.balance]));
  const sched = new Map(scheduled.map((point) => [point.month, point.balance]));
  const forecast = new Map(projected.map((point) => [point.month, point.balance]));
  const months = [...new Set([...actual.keys(), ...sched.keys(), ...forecast.keys()])].sort();
  return months.map((month) => ({
    month,
    actual: month <= current && actual.has(month) ? actual.get(month)! : null,
    actualProjected: month >= current && forecast.has(month) ? forecast.get(month)! : null,
    scheduled: month <= current && sched.has(month) ? sched.get(month)! : null,
    scheduledProjected: month >= current && sched.has(month) ? sched.get(month)! : null,
  }));
}

export function buildEquitySeries(
  walked: ActualWalk,
  official: Array<{ month: string; valueUsd: number }>,
  asOf: string,
): EquityChartPoint[] {
  const current = monthOf(asOf);
  const values = new Map(official.map((point) => [point.month, point.valueUsd]));
  return walked.months
    .filter((point) => point.month <= current)
    .map((point) => {
      const value = values.get(point.month) ?? null;
      return {
        month: point.month,
        value,
        balance: point.balance,
        equity: value == null ? null : roundCents(value - point.balance),
      };
    });
}

function previousMonthEnd(isoDate: string): string {
  const year = Number(isoDate.slice(0, 4));
  const month = Number(isoDate.slice(5, 7));
  if (month === 1) return endOfMonth(`${year - 1}-12`);
  return endOfMonth(`${year}-${String(month - 1).padStart(2, "0")}`);
}

/** Re-split total-only payments from the balance the schedule implies, leaving statement rows unchanged. */
export function recomputeComputedSplits(
  terms: MortgageTerms,
  payments: Array<PaymentDraft & { id: string }>,
  statements: StatementAnchor[],
): Array<{ id: string; principal: number; interest: number; escrow: number; extraPrincipal: number; balanceAfter: number | null; splitSource: SplitSource }> {
  const drafts = [...payments]
    .sort((a, b) => a.paidOn.localeCompare(b.paidOn) || a.id.localeCompare(b.id))
    .map((payment) => ({ ...payment }));
  const updates: Array<{ id: string; principal: number; interest: number; escrow: number; extraPrincipal: number; balanceAfter: number | null; splitSource: SplitSource }> = [];
  for (let index = 0; index < drafts.length; index += 1) {
    const payment = drafts[index]!;
    if (payment.splitSource !== "computed" && hasComponents(payment)) continue;
    const earlier = drafts.filter((row, rowIndex) => rowIndex < index);
    const priorAsOf = previousMonthEnd(payment.paidOn);
    let balance = walkActual(terms, earlier, statements, priorAsOf, null).balance;
    const before = [
      ...earlier
        .filter((row) => monthOf(row.paidOn) === monthOf(payment.paidOn))
        .map((row) => ({ date: row.paidOn, kind: "payment" as const, row })),
      ...statements
        .filter((row) => row.asOf < payment.paidOn && row.asOf > priorAsOf)
        .map((row) => ({ date: row.asOf, kind: "statement" as const, row })),
    ].sort((a, b) => a.date.localeCompare(b.date));
    for (const event of before) {
      balance = event.kind === "statement" ? roundCents(event.row.balanceUsd) : applyPayment(balance, terms, event.row).balanceAfter;
    }
    const applied = applyPayment(balance, terms, {
      ...payment,
      principal: null,
      interest: null,
      escrow: null,
      extraPrincipal: null,
      splitSource: null,
    });
    drafts[index] = {
      ...payment,
      principal: applied.principal,
      interest: applied.interest,
      escrow: applied.escrow,
      extraPrincipal: applied.extraPrincipal,
      balanceAfter: payment.balanceAfter != null ? roundCents(payment.balanceAfter) : applied.balanceAfter,
      splitSource: "computed",
    };
    updates.push({
      id: payment.id,
      principal: applied.principal,
      interest: applied.interest,
      escrow: applied.escrow,
      extraPrincipal: applied.extraPrincipal,
      balanceAfter: drafts[index]!.balanceAfter,
      splitSource: "computed",
    });
  }
  return updates;
}

export function buildMortgageView(input: {
  asOf: string;
  lender: string | null;
  terms: MortgageTerms | null;
  payments: StoredPayment[];
  statements: StatementAnchor[];
  ownerEstimate: { asOf: string; balanceUsd: number } | null;
  officialValue: number | null;
  official: Array<{ month: string; valueUsd: number }>;
  purchaseMonth: string | null;
}): MortgageView {
  const ready = mortgageTermsReady(input.terms);
  const resolved = resolveMortgageBalance({
    asOf: input.asOf,
    terms: input.terms,
    payments: input.payments,
    statements: input.statements,
    ownerEstimate: input.ownerEstimate,
    purchaseMonth: input.purchaseMonth,
  });
  const paid = interestPaid(input.payments, input.asOf);
  const base = {
    ready,
    lender: input.lender,
    originalPrincipal: input.terms?.originalPrincipal ?? null,
    annualRate: input.terms?.annualRate ?? null,
    termMonths: input.terms?.termMonths ?? null,
    firstPaymentDate: input.terms?.firstPaymentDate ?? null,
    monthlyPayment: input.terms?.monthlyPayment ?? null,
    monthlyEscrow: input.terms?.monthlyEscrow ?? null,
    extraPrincipal: input.terms?.extraPrincipal ?? 0,
    balanceUsd: resolved.balanceUsd,
    balanceAsOf: resolved.asOf,
    balanceSource: resolved.source,
    equityUsd: input.officialValue == null ? null : roundCents(input.officialValue - resolved.balanceUsd),
    payoffWithExtra: null,
    payoffWithout: null,
    monthsSaved: null,
    interestSaved: null,
    interestPaidYtd: paid.ytd,
    interestPaidToDate: paid.toDate,
    balanceSeries: [] as BalanceChartPoint[],
    equitySeries: [] as EquityChartPoint[],
    paymentSeries: paymentBars(input.payments),
    payments: input.payments,
  };
  if (!ready || !input.terms) return base;
  const walked = walkActual(input.terms, input.payments, input.statements, input.asOf, input.purchaseMonth);
  const withExtra = projectPayoff(resolved.balanceUsd, input.terms, input.terms.extraPrincipal, input.asOf);
  const without = projectPayoff(resolved.balanceUsd, input.terms, 0, input.asOf);
  return {
    ...base,
    payoffWithExtra: withExtra?.date ?? null,
    payoffWithout: without?.date ?? null,
    monthsSaved: withExtra && without ? without.months - withExtra.months : null,
    interestSaved: withExtra && without ? roundCents(without.interest - withExtra.interest) : null,
    balanceSeries: buildBalanceSeries(input.terms, walked, input.asOf, input.purchaseMonth),
    equitySeries: buildEquitySeries(walked, input.official, input.asOf),
  };
}

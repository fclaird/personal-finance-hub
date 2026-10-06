import { endOfMonth, monthOf, monthRange } from "@/lib/realEstate/months";

export type LoanBalanceSource = "owner_estimate" | "statement" | "amortization";

export type BalancePoint = {
  asOf: string;
  balanceUsd: number;
  source: LoanBalanceSource;
};

export type LoanTerms = {
  detailsComplete: boolean;
  annualRate: number | null;
  monthlyPayment: number | null;
  originalPrincipal: number | null;
  termMonths: number | null;
  startDate: string | null;
};

export function loanDetailsComplete(terms: Omit<LoanTerms, "detailsComplete">): boolean {
  if (terms.annualRate == null || !(terms.annualRate >= 0) || !terms.startDate) return false;
  if (terms.monthlyPayment != null && terms.monthlyPayment > 0) return true;
  return terms.originalPrincipal != null && terms.originalPrincipal > 0 && terms.termMonths != null && terms.termMonths > 0;
}

/** Accept 0.065 or 6.5. Reject anything above 30%. */
export function normalizeAnnualRate(raw: number): number | null {
  if (!Number.isFinite(raw) || raw < 0) return null;
  const rate = raw > 1 ? raw / 100 : raw;
  if (rate > 0.3) return null;
  return rate;
}

/** Level payment for a fully amortizing fixed-rate loan. Rate is an annual decimal. */
export function standardPayment(principal: number, annualRate: number, termMonths: number): number {
  if (!(principal > 0) || !(termMonths > 0)) throw new Error("principal and term are required");
  const monthly = annualRate / 12;
  if (monthly === 0) return principal / termMonths;
  const factor = (1 + monthly) ** termMonths;
  return (principal * monthly * factor) / (factor - 1);
}

export function amortizeOneMonth(balance: number, annualRate: number, payment: number): number {
  const next = balance * (1 + annualRate / 12) - payment;
  if (!Number.isFinite(next)) return balance;
  return Math.max(0, Math.round(next * 100) / 100);
}

/**
 * Balance at month-end. A statement or owner estimate inside the month wins over an amortization row.
 * Otherwise the latest point on or before month-end is carried forward.
 */
export function balanceForMonth(points: BalancePoint[], month: string): number {
  const end = endOfMonth(month);
  const eligible = points.filter((point) => point.asOf <= end);
  const inMonthManual = eligible.filter((point) => point.source !== "amortization" && monthOf(point.asOf) === month);
  const pool = inMonthManual.length > 0 ? inMonthManual : eligible;
  let best: BalancePoint | null = null;
  for (const point of pool) {
    if (!best || point.asOf > best.asOf) best = point;
  }
  return best?.balanceUsd ?? 0;
}

/**
 * Balance drawn on the value chart.
 * An incomplete owner estimate is carried across every month. A statement uses the dated balance.
 */
export function displayBalance(points: BalancePoint[], month: string, detailsComplete: boolean): number {
  const manuals = points.filter((point) => point.source !== "amortization");
  const hasStatement = manuals.some((point) => point.source === "statement");
  if (!detailsComplete && !hasStatement) {
    const estimates = manuals.filter((point) => point.source === "owner_estimate");
    if (estimates.length === 0) return 0;
    return estimates[estimates.length - 1]!.balanceUsd;
  }
  return balanceForMonth(points, month);
}

export function latestBalance(points: BalancePoint[], asOf: string): number {
  let best: BalancePoint | null = null;
  for (const point of points) {
    if (point.asOf > asOf) continue;
    if (!best || point.asOf > best.asOf) best = point;
  }
  return best?.balanceUsd ?? 0;
}

/**
 * Fill months after the latest manual balance with one amortization step each.
 * Incomplete terms leave the manual points unchanged.
 * A later statement replaces the schedule from that month forward.
 */
export function projectBalances(terms: LoanTerms, points: BalancePoint[], throughMonth: string): BalancePoint[] {
  const manuals = points.filter((point) => point.source !== "amortization");
  if (!terms.detailsComplete || terms.annualRate == null) return manuals.slice();
  const payment =
    terms.monthlyPayment != null && terms.monthlyPayment > 0
      ? terms.monthlyPayment
      : terms.originalPrincipal != null && terms.termMonths != null
        ? standardPayment(terms.originalPrincipal, terms.annualRate, terms.termMonths)
        : null;
  if (payment == null) return manuals.slice();

  const ordered = [...manuals].sort((a, b) => a.asOf.localeCompare(b.asOf));
  if (ordered.length === 0 && (terms.originalPrincipal == null || !terms.startDate)) return manuals.slice();

  const firstMonth = monthOf(ordered[0]?.asOf ?? terms.startDate!);
  if (firstMonth > throughMonth) return manuals.slice();

  let running: number | null = null;
  const out: BalancePoint[] = [...manuals];
  for (const month of monthRange(firstMonth, throughMonth)) {
    const inMonth = ordered.filter((point) => monthOf(point.asOf) === month);
    if (inMonth.length > 0) {
      running = inMonth[inMonth.length - 1]!.balanceUsd;
      continue;
    }
    if (running == null) continue;
    running = amortizeOneMonth(running, terms.annualRate, payment);
    out.push({ asOf: endOfMonth(month), balanceUsd: running, source: "amortization" });
  }
  return out;
}

"use client";

import { useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { formatUsd2 } from "@/lib/format";

type PaymentRow = {
  id: string;
  paidOn: string;
  totalPaid: number;
  principal: number | null;
  interest: number | null;
  escrow: number | null;
  extraPrincipal: number | null;
  balanceAfter: number | null;
  notes: string | null;
  splitSource: string;
};

export type MortgageSnapshot = {
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
  balanceSource: "statement" | "amortization" | "owner_estimate";
  equityUsd: number | null;
  payoffWithExtra: string | null;
  payoffWithout: string | null;
  monthsSaved: number | null;
  interestSaved: number | null;
  interestPaidYtd: number;
  interestPaidToDate: number;
  balanceSeries: Array<{ month: string; actual: number | null; actualProjected: number | null; scheduled: number | null; scheduledProjected: number | null }>;
  equitySeries: Array<{ month: string; value: number | null; balance: number | null; equity: number | null }>;
  paymentSeries: Array<{ month: string; principal: number; interest: number; extra: number }>;
  payments: PaymentRow[];
};

type LoanFields = {
  lender: string | null;
  annualRate: number | null;
  monthlyPayment: number | null;
  startDate: string | null;
  termMonths: number | null;
  monthlyEscrow: number | null;
  extraPrincipal: number;
  notes: string | null;
  mortgage: MortgageSnapshot | null;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const inputClass = "w-full rounded-lg border border-zinc-300 bg-white px-2.5 py-2 text-sm dark:border-white/20 dark:bg-zinc-950";
const buttonClass = "rounded-lg bg-zinc-950 px-3 py-2 text-sm font-semibold text-white dark:bg-white dark:text-black";
const quietButton = "rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-white/20";

const SOURCE_LABEL: Record<MortgageSnapshot["balanceSource"], string> = {
  statement: "Statement balance",
  amortization: "Amortized from the note and logged payments",
  owner_estimate: "Owner estimate",
};

function monthLabel(month: string): string {
  const index = Number(month.slice(5, 7)) - 1;
  return `${MONTHS[index] ?? month} ${month.slice(0, 4)}`;
}

function usd(value: number | null | undefined, masked: boolean): string {
  if (value == null || Number.isNaN(value)) return "—";
  return formatUsd2(value, { mask: masked });
}

function axisUsd(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${Math.round(value / 1_000)}k`;
  return `$${Math.round(value)}`;
}

function text(value: number | null | undefined): string {
  return value == null ? "" : String(value);
}

function rateText(rate: number | null): string {
  if (rate == null) return "";
  return String(Math.round(rate * 10000) / 100);
}

export function MortgagePanel({
  loan,
  masked,
  busy,
  onSend,
}: {
  loan: LoanFields;
  masked: boolean;
  busy: boolean;
  onSend: (url: string, body: unknown, method?: string) => void;
}) {
  const mortgage = loan.mortgage;
  const [terms, setTerms] = useState({
    lender: loan.lender ?? "",
    originalPrincipal: text(loan.mortgage?.originalPrincipal),
    annualRate: rateText(loan.annualRate),
    termMonths: text(loan.termMonths),
    firstPaymentDate: loan.startDate ?? "",
    monthlyPayment: text(loan.monthlyPayment),
    monthlyEscrow: text(loan.monthlyEscrow),
    extraPrincipal: text(loan.extraPrincipal ?? 0),
  });
  const [payment, setPayment] = useState({
    paidOn: new Date().toISOString().slice(0, 10),
    totalPaid: "",
    principal: "",
    interest: "",
    escrow: "",
    extraPrincipal: "",
    balanceAfter: "",
    notes: "",
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [statement, setStatement] = useState({ asOf: new Date().toISOString().slice(0, 10), balanceUsd: "" });
  const sample = (loan.lender ?? "").toLowerCase().includes("sample");
  const tickGap = Math.max(0, Math.ceil((mortgage?.balanceSeries.length ?? 0) / 8) - 1);

  function optionalNumber(value: string): number | null {
    const trimmed = value.trim();
    if (!trimmed) return null;
    return Number(trimmed);
  }

  return (
    <div className="space-y-6 px-4 py-4">
      {sample ? (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-950 dark:bg-amber-950/40 dark:text-amber-100">
          Sample loan figures for checking the charts. They are not the Crownsville note.
        </p>
      ) : null}
      <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
        The balance used for equity is the latest statement, otherwise the note amortized with logged payments and the standing extra, otherwise the owner estimate.
        {mortgage ? ` Showing ${SOURCE_LABEL[mortgage.balanceSource].toLowerCase()}${mortgage.balanceAsOf ? ` as of ${mortgage.balanceAsOf}` : ""}.` : ""}
      </p>
      {loan.notes && mortgage?.balanceSource === "owner_estimate" ? <p className="text-sm text-zinc-500">{loan.notes}</p> : null}

      {mortgage?.ready ? (
        <>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-zinc-500">Balance</dt>
              <dd className="font-medium">{usd(mortgage.balanceUsd, masked)}</dd>
            </div>
            <div>
              <dt className="text-zinc-500">Equity</dt>
              <dd className="font-medium">{usd(mortgage.equityUsd, masked)}</dd>
            </div>
            <div>
              <dt className="text-zinc-500">Payoff with extra</dt>
              <dd className="font-medium">{mortgage.payoffWithExtra ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-zinc-500">Payoff without extra</dt>
              <dd className="font-medium">{mortgage.payoffWithout ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-zinc-500">Months saved</dt>
              <dd className="font-medium">{mortgage.monthsSaved ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-zinc-500">Interest saved</dt>
              <dd className="font-medium">{usd(mortgage.interestSaved, masked)}</dd>
            </div>
            <div>
              <dt className="text-zinc-500">Interest paid YTD</dt>
              <dd className="font-medium">{usd(mortgage.interestPaidYtd, masked)}</dd>
            </div>
            <div>
              <dt className="text-zinc-500">Interest paid to date</dt>
              <dd className="font-medium">{usd(mortgage.interestPaidToDate, masked)}</dd>
            </div>
          </dl>
          <p className="text-xs leading-5 text-zinc-500">
            Payoff dates and interest saved start from the current balance. With extra keeps paying the standing extra each month. Without extra pays principal and interest only.
          </p>
          <ChartFrame title="Principal balance" caption="Vertical axis is principal in dollars. Horizontal axis is the month. Solid lines run through today. Dashed lines carry the same path forward.">
            <LineChart data={mortgage.balanceSeries.map((point) => ({ ...point, label: monthLabel(point.month) }))} margin={{ top: 8, right: 8, left: 8, bottom: 24 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.15} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={tickGap} height={36} />
              <YAxis tickFormatter={(value) => (masked ? "" : axisUsd(Number(value)))} width={56} tick={{ fontSize: 11 }} domain={[0, "auto"]} />
              <Tooltip formatter={(value, name) => [usd(typeof value === "number" ? value : Number(value), masked), String(name)]} />
              <Legend />
              <Line type="monotone" dataKey="actual" name="Actual" stroke="#b45309" strokeWidth={2} dot={false} connectNulls />
              <Line type="monotone" dataKey="actualProjected" name="Actual, projected" stroke="#b45309" strokeDasharray="5 4" dot={false} connectNulls />
              <Line type="monotone" dataKey="scheduled" name="Scheduled" stroke="#71717a" strokeWidth={2} dot={false} connectNulls />
              <Line type="monotone" dataKey="scheduledProjected" name="Scheduled, projected" stroke="#71717a" strokeDasharray="5 4" dot={false} connectNulls />
            </LineChart>
          </ChartFrame>
          <ChartFrame title="Equity" caption="Vertical axis is dollars. Horizontal axis is the month, from the June 2024 purchase through this month. Equity is official value minus principal. Months without an official value stay blank.">
            <LineChart data={mortgage.equitySeries.map((point) => ({ ...point, label: monthLabel(point.month) }))} margin={{ top: 8, right: 8, left: 8, bottom: 24 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.15} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={tickGap} height={36} />
              <YAxis tickFormatter={(value) => (masked ? "" : axisUsd(Number(value)))} width={56} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(value, name) => [usd(typeof value === "number" ? value : Number(value), masked), String(name)]} />
              <Legend />
              <Line type="monotone" dataKey="value" name="Official value" stroke="#0f766e" strokeWidth={2} dot={false} connectNulls />
              <Line type="monotone" dataKey="balance" name="Principal" stroke="#b45309" strokeWidth={2} dot={false} connectNulls />
              <Line type="monotone" dataKey="equity" name="Equity" stroke="#1d4ed8" strokeWidth={2} dot={{ r: 2 }} connectNulls />
            </LineChart>
          </ChartFrame>
          {mortgage.paymentSeries.length === 0 ? (
            <p className="text-sm text-zinc-500">No payments logged yet. A total and a date are enough; the split is computed from the terms.</p>
          ) : (
            <ChartFrame title="Payment split" caption="Vertical axis is dollars paid. Horizontal axis is the month. Each bar stacks principal, interest, and extra principal.">
              <BarChart data={mortgage.paymentSeries.map((point) => ({ ...point, label: monthLabel(point.month) }))} margin={{ top: 8, right: 8, left: 8, bottom: 24 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.15} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} height={36} />
                <YAxis tickFormatter={(value) => (masked ? "" : axisUsd(Number(value)))} width={56} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(value, name) => [usd(typeof value === "number" ? value : Number(value), masked), String(name)]} />
                <Legend />
                <Bar dataKey="principal" name="Principal" stackId="pay" fill="#0f766e" />
                <Bar dataKey="interest" name="Interest" stackId="pay" fill="#b45309" />
                <Bar dataKey="extra" name="Extra principal" stackId="pay" fill="#1d4ed8" />
              </BarChart>
            </ChartFrame>
          )}
        </>
      ) : (
        <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          Enter original principal, note rate, term, first payment date, and the monthly principal and interest to plot the payoff. Until then the owner estimate is carried and not amortized.
        </p>
      )}

      <form
        className="grid gap-3 border-t border-zinc-200 pt-4 sm:grid-cols-4 dark:border-white/10"
        onSubmit={(event) => {
          event.preventDefault();
          onSend("/api/real-estate/loans", {
            propertyId: "re_crownsville",
            lender: terms.lender.trim() || null,
            originalPrincipal: Number(terms.originalPrincipal),
            interestRate: Number(terms.annualRate),
            termMonths: Number(terms.termMonths),
            firstPaymentDate: terms.firstPaymentDate,
            monthlyPayment: Number(terms.monthlyPayment),
            monthlyEscrow: optionalNumber(terms.monthlyEscrow),
            extraPrincipal: optionalNumber(terms.extraPrincipal) ?? 0,
          });
        }}
      >
        <p className="text-sm font-medium sm:col-span-4">Loan terms</p>
        <label className="text-sm sm:col-span-2">
          Lender
          <input className={inputClass} value={terms.lender} onChange={(event) => setTerms({ ...terms, lender: event.target.value })} />
        </label>
        <label className="text-sm">
          Original principal
          <input className={inputClass} inputMode="decimal" value={terms.originalPrincipal} onChange={(event) => setTerms({ ...terms, originalPrincipal: event.target.value })} required />
        </label>
        <label className="text-sm">
          Note rate (APR %)
          <input className={inputClass} inputMode="decimal" placeholder="6.5" value={terms.annualRate} onChange={(event) => setTerms({ ...terms, annualRate: event.target.value })} required />
        </label>
        <label className="text-sm">
          Term (months)
          <input className={inputClass} inputMode="numeric" value={terms.termMonths} onChange={(event) => setTerms({ ...terms, termMonths: event.target.value })} required />
        </label>
        <label className="text-sm">
          First payment date
          <input className={inputClass} type="date" value={terms.firstPaymentDate} onChange={(event) => setTerms({ ...terms, firstPaymentDate: event.target.value })} required />
        </label>
        <label className="text-sm">
          Monthly principal and interest
          <input className={inputClass} inputMode="decimal" value={terms.monthlyPayment} onChange={(event) => setTerms({ ...terms, monthlyPayment: event.target.value })} required />
        </label>
        <label className="text-sm">
          Monthly escrow
          <input className={inputClass} inputMode="decimal" value={terms.monthlyEscrow} onChange={(event) => setTerms({ ...terms, monthlyEscrow: event.target.value })} />
        </label>
        <label className="text-sm">
          Extra principal per month
          <input className={inputClass} inputMode="decimal" value={terms.extraPrincipal} onChange={(event) => setTerms({ ...terms, extraPrincipal: event.target.value })} />
        </label>
        <div className="sm:col-span-4">
          <button className={buttonClass} type="submit" disabled={busy}>
            Save loan terms
          </button>
        </div>
      </form>

      <form
        className="grid gap-3 border-t border-zinc-200 pt-4 sm:grid-cols-4 dark:border-white/10"
        onSubmit={(event) => {
          event.preventDefault();
          const body = {
            paidOn: payment.paidOn,
            totalPaid: Number(payment.totalPaid || 0),
            principal: optionalNumber(payment.principal),
            interest: optionalNumber(payment.interest),
            escrow: optionalNumber(payment.escrow),
            extraPrincipal: optionalNumber(payment.extraPrincipal),
            balanceAfter: optionalNumber(payment.balanceAfter),
            notes: payment.notes.trim() || null,
          };
          if (editingId) onSend("/api/real-estate/loan-payments", { id: editingId, propertyId: "re_crownsville", ...body }, "PATCH");
          else onSend("/api/real-estate/loan-payments", { propertyId: "re_crownsville", ...body });
          setEditingId(null);
        }}
      >
        <p className="text-sm font-medium sm:col-span-4">{editingId ? "Edit payment" : "Log a payment"}</p>
        <label className="text-sm">
          Date paid
          <input className={inputClass} type="date" value={payment.paidOn} onChange={(event) => setPayment({ ...payment, paidOn: event.target.value })} required />
        </label>
        <label className="text-sm">
          Total paid
          <input className={inputClass} inputMode="decimal" value={payment.totalPaid} onChange={(event) => setPayment({ ...payment, totalPaid: event.target.value })} required />
        </label>
        <label className="text-sm">
          Principal
          <input className={inputClass} inputMode="decimal" value={payment.principal} onChange={(event) => setPayment({ ...payment, principal: event.target.value })} />
        </label>
        <label className="text-sm">
          Interest
          <input className={inputClass} inputMode="decimal" value={payment.interest} onChange={(event) => setPayment({ ...payment, interest: event.target.value })} />
        </label>
        <label className="text-sm">
          Escrow
          <input className={inputClass} inputMode="decimal" value={payment.escrow} onChange={(event) => setPayment({ ...payment, escrow: event.target.value })} />
        </label>
        <label className="text-sm">
          Extra principal
          <input className={inputClass} inputMode="decimal" value={payment.extraPrincipal} onChange={(event) => setPayment({ ...payment, extraPrincipal: event.target.value })} />
        </label>
        <label className="text-sm">
          Statement balance after
          <input className={inputClass} inputMode="decimal" value={payment.balanceAfter} onChange={(event) => setPayment({ ...payment, balanceAfter: event.target.value })} />
        </label>
        <label className="text-sm">
          Notes
          <input className={inputClass} value={payment.notes} onChange={(event) => setPayment({ ...payment, notes: event.target.value })} />
        </label>
        <div className="flex gap-2 sm:col-span-4">
          <button className={buttonClass} type="submit" disabled={busy}>
            {editingId ? "Update payment" : "Save payment"}
          </button>
          {editingId ? (
            <button
              className={quietButton}
              type="button"
              onClick={() => {
                setEditingId(null);
                setPayment({ paidOn: new Date().toISOString().slice(0, 10), totalPaid: "", principal: "", interest: "", escrow: "", extraPrincipal: "", balanceAfter: "", notes: "" });
              }}
            >
              Cancel
            </button>
          ) : null}
        </div>
      </form>

      {mortgage && mortgage.payments.length > 0 ? (
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="py-1 pr-3">Date</th>
              <th className="py-1 pr-3">Total</th>
              <th className="py-1 pr-3">Principal</th>
              <th className="py-1 pr-3">Interest</th>
              <th className="py-1 pr-3">Extra</th>
              <th className="py-1 pr-3">Split</th>
              <th className="py-1"> </th>
            </tr>
          </thead>
          <tbody>
            {mortgage.payments.map((row) => (
              <tr key={row.id} className="border-t border-zinc-200 dark:border-white/10">
                <td className="py-1.5 pr-3">{row.paidOn}</td>
                <td className="py-1.5 pr-3">{usd(row.totalPaid, masked)}</td>
                <td className="py-1.5 pr-3">{usd(row.principal, masked)}</td>
                <td className="py-1.5 pr-3">{usd(row.interest, masked)}</td>
                <td className="py-1.5 pr-3">{usd(row.extraPrincipal, masked)}</td>
                <td className="py-1.5 pr-3">{row.splitSource === "computed" ? "Computed" : "Statement"}</td>
                <td className="py-1.5 text-right">
                  <button
                    type="button"
                    className="mr-2 underline"
                    onClick={() => {
                      setEditingId(row.id);
                      setPayment({
                        paidOn: row.paidOn,
                        totalPaid: text(row.totalPaid),
                        principal: text(row.principal),
                        interest: text(row.interest),
                        escrow: text(row.escrow),
                        extraPrincipal: text(row.extraPrincipal),
                        balanceAfter: text(row.balanceAfter),
                        notes: row.notes ?? "",
                      });
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="underline"
                    onClick={() => {
                      if (window.confirm(`Delete the payment on ${row.paidOn}?`)) onSend("/api/real-estate/loan-payments", { id: row.id }, "DELETE");
                    }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      <form
        className="grid gap-3 border-t border-zinc-200 pt-4 sm:grid-cols-3 dark:border-white/10"
        onSubmit={(event) => {
          event.preventDefault();
          onSend("/api/real-estate/loan-balances", {
            propertyId: "re_crownsville",
            asOf: statement.asOf,
            balanceUsd: Number(statement.balanceUsd),
            notes: null,
          });
        }}
      >
        <p className="text-sm font-medium sm:col-span-3">Statement principal</p>
        <label className="text-sm">
          Statement date
          <input className={inputClass} type="date" value={statement.asOf} onChange={(event) => setStatement({ ...statement, asOf: event.target.value })} required />
        </label>
        <label className="text-sm">
          Principal balance
          <input className={inputClass} inputMode="decimal" value={statement.balanceUsd} onChange={(event) => setStatement({ ...statement, balanceUsd: event.target.value })} required />
        </label>
        <div className="flex items-end">
          <button className={buttonClass} type="submit" disabled={busy}>
            Save statement balance
          </button>
        </div>
      </form>
    </div>
  );
}

function ChartFrame({ title, caption, children }: { title: string; caption: string; children: ReactNode }) {
  return (
    <figure className="space-y-2">
      <figcaption>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs leading-5 text-zinc-500">{caption}</p>
      </figcaption>
      <div className="h-72 w-full min-w-0">
        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={288} initialDimension={{ width: 720, height: 288 }}>
          {children}
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

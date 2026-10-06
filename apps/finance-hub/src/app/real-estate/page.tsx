"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { DraggableTileLayout } from "@/app/components/DraggableTileLayout";
import { EditablePageHeading } from "@/app/components/EditableHeading";
import { usePrivacy } from "@/app/components/PrivacyProvider";
import { formatUsd2 } from "@/lib/format";

type Reading = {
  id: string;
  asOf: string;
  valueUsd: number;
  lowUsd: number | null;
  highUsd: number | null;
  source: string;
  sourceDetail: string | null;
  sourceUrl: string | null;
  notes: string | null;
};

type SeriesPoint = {
  month: string;
  valueUsd: number;
  lowUsd: number;
  highUsd: number;
  method: string;
  loanBalance: number;
  equity: number;
};

type Property = {
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
    balanceUsd: number;
    balanceAsOf: string | null;
    balanceSource: string | null;
    detailsComplete: boolean;
    notes: string | null;
    annualRate: number | null;
    monthlyPayment: number | null;
    startDate: string | null;
  } | null;
  readings: Reading[];
  series: SeriesPoint[];
  officialValue: number | null;
  loanBalance: number;
};

type Payload = {
  ok: boolean;
  error?: string;
  investableNote?: string | null;
  hpiFetchedAt?: string | null;
  netWorth?: {
    status: "ready" | "incomplete";
    investable: number;
    realEstateAssets: number | null;
    mortgage: number;
    netWorth: number | null;
  };
  properties?: Property[];
};

const METHOD_LABEL: Record<string, string> = {
  appraisal_anchor: "Appraisal",
  hpi_from_appraisal: "Appraisal, indexed",
  avm_blend: "Public estimates",
  hpi_from_official: "Indexed from last value",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function monthLabel(month: string): string {
  const index = Number(month.slice(5, 7)) - 1;
  return `${MONTHS[index] ?? month} ${month.slice(0, 4)}`;
}

function usd(value: number | null | undefined, masked: boolean): string {
  if (value == null) return "—";
  return formatUsd2(value, { mask: masked });
}

function sourceLabel(reading: Reading): string {
  if (reading.source === "purchase") return "Purchase (reference)";
  if (reading.source === "assessor") return "County (reference)";
  if (reading.source === "appraisal") return "Appraisal";
  return reading.sourceDetail ? reading.sourceDetail[0]!.toUpperCase() + reading.sourceDetail.slice(1) : "Estimate";
}

function axisUsd(value: number): string {
  if (!Number.isFinite(value)) return "";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${Math.round(value / 1_000)}k`;
  return `$${Math.round(value)}`;
}

function PropertyChart({ property, masked }: { property: Property; masked: boolean }) {
  const data = property.series.map((point) => {
    const spread = point.highUsd - point.lowUsd > 1;
    return {
      month: monthLabel(point.month),
      value: point.valueUsd,
      low: spread ? point.lowUsd : null,
      high: spread ? point.highUsd : null,
      loan: point.loanBalance,
      equity: point.equity,
    };
  });
  if (data.length === 0) {
    return (
      <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
        No official monthly value yet. Enter at least two public estimates for the same month, or an appraisal. The
        purchase price stays a reference point and does not set the line.
      </p>
    );
  }
  const showSpread = data.some((point) => point.low != null || point.high != null);
  return (
    <div className="h-80 w-full min-w-0">
      <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={320} initialDimension={{ width: 640, height: 320 }}>
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.15} />
          <XAxis dataKey="month" tick={{ fontSize: 12 }} />
          <YAxis tickFormatter={(value) => (masked ? "" : axisUsd(Number(value)))} width={64} tick={{ fontSize: 12 }} />
          <Tooltip
            formatter={(value, name) => [usd(typeof value === "number" ? value : Number(value), masked), String(name)]}
          />
          <Legend />
          {showSpread ? <Line type="monotone" dataKey="high" name="High" stroke="#5eead4" strokeDasharray="4 4" dot={false} connectNulls /> : null}
          {showSpread ? <Line type="monotone" dataKey="low" name="Low" stroke="#99f6e4" strokeDasharray="4 4" dot={false} connectNulls /> : null}
          <Line type="monotone" dataKey="value" name="Value" stroke="#0f766e" strokeWidth={2} dot={{ r: 3 }} />
          <Line type="monotone" dataKey="loan" name="Loan" stroke="#b45309" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="equity" name="Equity" stroke="#1d4ed8" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

const inputClass =
  "w-full rounded-lg border border-zinc-300 bg-white px-2.5 py-2 text-sm dark:border-white/20 dark:bg-zinc-950";
const buttonClass =
  "rounded-lg bg-zinc-950 px-3 py-2 text-sm font-semibold text-white dark:bg-white dark:text-black";

export default function RealEstatePage() {
  const privacy = usePrivacy();
  const [payload, setPayload] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    propertyId: "re_cortland",
    asOf: new Date().toISOString().slice(0, 10),
    source: "zillow",
    valueUsd: "",
    lowUsd: "",
    highUsd: "",
    sourceUrl: "",
    notes: "",
  });
  const [statement, setStatement] = useState({ asOf: new Date().toISOString().slice(0, 10), balanceUsd: "", notes: "" });
  const [terms, setTerms] = useState({ annualRate: "", startDate: "", monthlyPayment: "", termMonths: "", originalPrincipal: "", lender: "" });

  const load = useCallback(async () => {
    const response = await fetch("/api/real-estate", { cache: "no-store" });
    const json = (await response.json()) as Payload;
    if (!response.ok || !json.ok) {
      setError(json.error ?? `Could not load real estate (${response.status})`);
      return;
    }
    setError(null);
    setPayload(json);
    const first = json.properties?.[0]?.id;
    if (first) setForm((prev) => ({ ...prev, propertyId: prev.propertyId || first }));
  }, []);

  useEffect(() => {
    void load().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [load]);

  async function post(url: string, body: unknown) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await response.json()) as Payload;
      if (!response.ok || json.ok === false) {
        setError(json.error ?? `Request failed (${response.status})`);
        return;
      }
      if (json.properties) setPayload(json);
      else await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const properties = payload?.properties ?? [];
  const netWorth = payload?.netWorth;

  const tiles = useMemo(() => {
    const propertyTiles = Object.fromEntries(
      properties.map((property) => [
        property.id,
        {
          title: property.label,
          children: (
            <div className="space-y-4 px-4 py-4">
              <div>
                <p className="text-sm font-medium">
                  {property.street}, {property.city}, {property.state} {property.postalCode ?? ""}
                </p>
                {property.mailingStreet ? (
                  <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                    Mailing address {property.mailingStreet} is not the house or the side lot.
                  </p>
                ) : null}
                {property.ownerName ? (
                  <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">Owner of record: {property.ownerName}</p>
                ) : null}
              </div>
              {property.caveat ? (
                <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-950 dark:bg-amber-950/40 dark:text-amber-100">
                  {property.caveat}
                </p>
              ) : null}
              <ul className="space-y-1 text-sm text-zinc-700 dark:text-zinc-300">
                {property.parcels.map((parcel) => (
                  <li key={parcel.id}>
                    {parcel.role === "side_lot" ? "Side lot" : "House"} {parcel.street ?? property.street} · parcel {parcel.apn} ·{" "}
                    {parcel.county} County
                  </li>
                ))}
              </ul>
              <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-zinc-500">Official value</dt>
                  <dd className="font-medium">{usd(property.officialValue, privacy.masked)}</dd>
                </div>
                <div>
                  <dt className="text-zinc-500">Loan</dt>
                  <dd className="font-medium">{usd(property.loanBalance, privacy.masked)}</dd>
                </div>
                <div>
                  <dt className="text-zinc-500">Equity</dt>
                  <dd className="font-medium">
                    {usd(property.officialValue == null ? null : property.officialValue - property.loanBalance, privacy.masked)}
                  </dd>
                </div>
                <div>
                  <dt className="text-zinc-500">Index</dt>
                  <dd className="font-medium">{property.hpiLatestPeriod ?? "Not downloaded"}</dd>
                </div>
              </dl>
              {property.loan && !property.loan.detailsComplete ? (
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  Mortgage is an incomplete owner estimate
                  {property.loan.balanceAsOf ? ` as of ${property.loan.balanceAsOf}` : ""}. It is carried, not amortized.
                  {property.loan.notes ? ` ${property.loan.notes}` : ""}
                </p>
              ) : null}
              <PropertyChart property={property} masked={privacy.masked} />
              {property.series.length > 0 ? (
                <p className="text-xs text-zinc-500">
                  Latest point: {METHOD_LABEL[property.series[property.series.length - 1]!.method] ?? "Value"}
                  {property.series.some((point) => point.highUsd - point.lowUsd > 1) ? ". Dashed lines are the estimate spread." : ""}
                </p>
              ) : null}
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-zinc-500">
                  <tr>
                    <th className="py-1 pr-3">Date</th>
                    <th className="py-1 pr-3">Source</th>
                    <th className="py-1 pr-3">Value</th>
                    <th className="py-1">Range</th>
                  </tr>
                </thead>
                <tbody>
                  {property.readings.map((reading) => (
                    <tr key={reading.id} className="border-t border-zinc-200 dark:border-white/10">
                      <td className="py-1.5 pr-3">{reading.asOf}</td>
                      <td className="py-1.5 pr-3">
                        {reading.sourceUrl ? (
                          <a className="underline" href={reading.sourceUrl} target="_blank" rel="noreferrer">
                            {sourceLabel(reading)}
                          </a>
                        ) : (
                          sourceLabel(reading)
                        )}
                      </td>
                      <td className="py-1.5 pr-3">{usd(reading.valueUsd, privacy.masked)}</td>
                      <td className="py-1.5">
                        {reading.lowUsd != null || reading.highUsd != null
                          ? `${usd(reading.lowUsd, privacy.masked)} – ${usd(reading.highUsd, privacy.masked)}`
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ),
        },
      ]),
    );
    return {
      summary: {
        title: "Net worth",
        children: (
          <div className="space-y-4 px-4 py-4">
            <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
              Investable assets are the same brokerage total as the terminal, and this tab does not change that total.
              Real estate is market value. The mortgage is a separate liability.
            </p>
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-zinc-500">Investable</dt>
                <dd className="text-lg font-semibold">{usd(netWorth?.investable, privacy.masked)}</dd>
              </div>
              <div>
                <dt className="text-zinc-500">Real estate</dt>
                <dd className="text-lg font-semibold">{usd(netWorth?.realEstateAssets, privacy.masked)}</dd>
              </div>
              <div>
                <dt className="text-zinc-500">Mortgage</dt>
                <dd className="text-lg font-semibold">{usd(netWorth?.mortgage, privacy.masked)}</dd>
              </div>
              <div>
                <dt className="text-zinc-500">Net worth</dt>
                <dd className="text-lg font-semibold">{usd(netWorth?.netWorth, privacy.masked)}</dd>
              </div>
            </dl>
            {netWorth?.status === "incomplete" ? (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Net worth appears once each property has an official value from an appraisal or from at least two
                public estimates in the same month.
              </p>
            ) : null}
            {payload?.investableNote ? <p className="text-sm text-zinc-500">{payload.investableNote}</p> : null}
            <button type="button" className={buttonClass} disabled={busy} onClick={() => void post("/api/real-estate/refresh", {})}>
              {busy ? "Working…" : "Refresh house-price index"}
            </button>
            {payload?.hpiFetchedAt ? (
              <p className="text-xs text-zinc-500">Index downloaded {payload.hpiFetchedAt}</p>
            ) : (
              <p className="text-xs text-zinc-500">FHFA index has not been downloaded yet. Estimates you enter still count.</p>
            )}
          </div>
        ),
      },
      ...propertyTiles,
      entry: {
        title: "Add a reading",
        children: (
          <form
            className="grid gap-3 px-4 py-4 sm:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              const sourceMap: Record<string, { source: string; sourceDetail: string }> = {
                zillow: { source: "manual_avm", sourceDetail: "zillow" },
                redfin: { source: "manual_avm", sourceDetail: "redfin" },
                realtor: { source: "manual_avm", sourceDetail: "realtor" },
                assessor: { source: "assessor", sourceDetail: "county" },
                appraisal: { source: "appraisal", sourceDetail: "appraisal" },
                purchase: { source: "purchase", sourceDetail: "purchase" },
              };
              const mapped = sourceMap[form.source] ?? sourceMap.zillow!;
              void post("/api/real-estate/valuations", {
                propertyId: form.propertyId,
                asOf: form.asOf,
                valueUsd: Number(form.valueUsd),
                lowUsd: form.lowUsd ? Number(form.lowUsd) : null,
                highUsd: form.highUsd ? Number(form.highUsd) : null,
                source: mapped.source,
                sourceDetail: mapped.sourceDetail,
                sourceUrl: form.sourceUrl || null,
                notes: form.notes || null,
              });
            }}
          >
            <label className="text-sm">
              Property
              <select className={inputClass} value={form.propertyId} onChange={(event) => setForm({ ...form, propertyId: event.target.value })}>
                {properties.map((property) => (
                  <option key={property.id} value={property.id}>
                    {property.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Read date
              <input className={inputClass} type="date" value={form.asOf} onChange={(event) => setForm({ ...form, asOf: event.target.value })} required />
            </label>
            <label className="text-sm">
              Source
              <select className={inputClass} value={form.source} onChange={(event) => setForm({ ...form, source: event.target.value })}>
                <option value="zillow">Zillow</option>
                <option value="redfin">Redfin</option>
                <option value="realtor">Realtor.com</option>
                <option value="assessor">County assessor (reference)</option>
                <option value="appraisal">Appraisal</option>
                <option value="purchase">Purchase (reference)</option>
              </select>
            </label>
            <label className="text-sm">
              Value
              <input className={inputClass} inputMode="decimal" value={form.valueUsd} onChange={(event) => setForm({ ...form, valueUsd: event.target.value })} required />
            </label>
            <label className="text-sm">
              Low
              <input className={inputClass} inputMode="decimal" value={form.lowUsd} onChange={(event) => setForm({ ...form, lowUsd: event.target.value })} />
            </label>
            <label className="text-sm">
              High
              <input className={inputClass} inputMode="decimal" value={form.highUsd} onChange={(event) => setForm({ ...form, highUsd: event.target.value })} />
            </label>
            <label className="text-sm sm:col-span-2">
              URL
              <input className={inputClass} value={form.sourceUrl} onChange={(event) => setForm({ ...form, sourceUrl: event.target.value })} placeholder="https://" />
            </label>
            <label className="text-sm sm:col-span-2">
              Notes
              <input className={inputClass} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
            </label>
            <div className="sm:col-span-2">
              <button className={buttonClass} type="submit" disabled={busy}>
                Save reading
              </button>
            </div>
            <div className="space-y-3 border-t border-zinc-200 pt-4 sm:col-span-2 dark:border-white/10">
              <p className="text-sm font-medium">Crownsville mortgage</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm">
                  Statement date
                  <input className={inputClass} type="date" value={statement.asOf} onChange={(event) => setStatement({ ...statement, asOf: event.target.value })} />
                </label>
                <label className="text-sm">
                  Principal
                  <input className={inputClass} inputMode="decimal" value={statement.balanceUsd} onChange={(event) => setStatement({ ...statement, balanceUsd: event.target.value })} />
                </label>
              </div>
              <button
                className={buttonClass}
                type="button"
                disabled={busy || !statement.balanceUsd}
                onClick={() =>
                  void post("/api/real-estate/loan-balances", {
                    propertyId: "re_crownsville",
                    asOf: statement.asOf,
                    balanceUsd: Number(statement.balanceUsd),
                    notes: statement.notes || null,
                  })
                }
              >
                Save statement balance
              </button>
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="text-sm">
                  Rate
                  <input className={inputClass} placeholder="6.5" value={terms.annualRate} onChange={(event) => setTerms({ ...terms, annualRate: event.target.value })} />
                </label>
                <label className="text-sm">
                  Start
                  <input className={inputClass} type="date" value={terms.startDate} onChange={(event) => setTerms({ ...terms, startDate: event.target.value })} />
                </label>
                <label className="text-sm">
                  Payment
                  <input className={inputClass} inputMode="decimal" value={terms.monthlyPayment} onChange={(event) => setTerms({ ...terms, monthlyPayment: event.target.value })} />
                </label>
              </div>
              <button
                className={buttonClass}
                type="button"
                disabled={busy || !terms.annualRate || !terms.startDate}
                onClick={() =>
                  void post("/api/real-estate/loans", {
                    propertyId: "re_crownsville",
                    lender: terms.lender || null,
                    annualRate: Number(terms.annualRate),
                    startDate: terms.startDate,
                    monthlyPayment: terms.monthlyPayment ? Number(terms.monthlyPayment) : null,
                    termMonths: terms.termMonths ? Number(terms.termMonths) : null,
                    originalPrincipal: terms.originalPrincipal ? Number(terms.originalPrincipal) : null,
                  })
                }
              >
                Save loan terms
              </button>
            </div>
          </form>
        ),
      },
    };
  }, [properties, privacy.masked, netWorth, payload, busy, form, statement, terms]);

  return (
    <div className="flex w-full max-w-[108rem] flex-1 flex-col gap-6 py-10 pl-5 pr-6 sm:pl-6 sm:pr-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          <EditablePageHeading pageId="real-estate" defaultTitle="Real Estate" />
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          Two owned properties on the Main flavor. Monthly value comes from readings you or an assistant enter. The app
          does not scrape listing sites. FHFA&apos;s house price index fills months that have fewer than two estimates,
          and an appraisal replaces that path when it is the newest anchor.
        </p>
      </div>
      {error ? <div className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-900 dark:bg-red-950/30 dark:text-red-100">{error}</div> : null}
      {!payload && !error ? <p className="text-sm text-zinc-500">Loading…</p> : null}
      {payload?.ok ? (
        <DraggableTileLayout storageKey="fh.realEstate.tiles.v1" defaultOrder={["summary", ...properties.map((property) => property.id), "entry"]} tiles={tiles} />
      ) : null}
    </div>
  );
}

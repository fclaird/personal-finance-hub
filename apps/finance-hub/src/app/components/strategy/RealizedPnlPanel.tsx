"use client";

import { useCallback, useEffect, useState } from "react";

import { pnlTone } from "@/app/components/strategy/SituationLifecycle";
import { SymbolLink } from "@/app/components/SymbolLink";
import { formatUsd2 } from "@/lib/format";
import type { RealizedPeriod, RealizedSummary } from "@/lib/strategy/realizedByStrategy";

type ApiOk = { ok: true } & RealizedSummary;
type ApiErr = { ok: false; error?: string };

export function RealizedPnlPanel({ privacyMasked }: { privacyMasked: boolean }) {
  const [periodChoice, setPeriodChoice] = useState<"all" | "ytd" | string>("all");
  const [data, setData] = useState<RealizedSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (choice: string) => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ period: choice });
      const resp = await fetch(`/api/strategy-realized?${qs.toString()}`, { cache: "no-store" });
      const json = (await resp.json()) as ApiOk | ApiErr;
      if (!json.ok) throw new Error("error" in json ? json.error : "Failed to load");
      setData({
        period: json.period,
        years: json.years,
        grandTotal: json.grandTotal,
        bookCount: json.bookCount,
        skippedOpen: json.skippedOpen,
        skippedRejected: json.skippedRejected,
        skippedNoRealized: json.skippedNoRealized,
        strategies: json.strategies,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(periodChoice);
  }, [load, periodChoice]);

  const years = data?.years ?? [];
  const csvHref = `/api/strategy-realized?period=${encodeURIComponent(periodChoice)}&format=csv`;

  function usd(v: number): string {
    return formatUsd2(v, { mask: privacyMasked });
  }

  function tone(v: number): string {
    return pnlTone(v, { realized: true });
  }

  function periodLabel(period: RealizedPeriod | undefined): string {
    if (!period) return "";
    if (period.type === "all") return "all-time";
    if (period.type === "ytd") return `year-to-date ${period.year}`;
    return String(period.year);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Realized G/L</h2>
          <p className="mt-1 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
            Closed option books only. Same FIFO realized the Strategies tree shows as{" "}
            <strong>Realized</strong> (closed-book Net). Open credit and still-open structures are excluded.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void load(periodChoice)}
            disabled={loading}
            className="rounded-full border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-900 hover:bg-zinc-50 disabled:opacity-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5"
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
          <a
            href={csvHref}
            className="rounded-full border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-900 shadow-sm hover:bg-zinc-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5"
          >
            Export CSV
          </a>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        {(
          [
            ["all", "All-time"],
            ["ytd", "Year to date"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setPeriodChoice(id)}
            className={
              "rounded-full px-3 py-1 font-medium " +
              (periodChoice === id
                ? "bg-zinc-950 text-white dark:bg-white dark:text-black"
                : "border border-zinc-300 text-zinc-700 hover:bg-zinc-50 dark:border-white/20 dark:text-zinc-200 dark:hover:bg-white/5")
            }
          >
            {label}
          </button>
        ))}
        {years.length > 0 ? (
          <label className="ml-1 flex items-center gap-1.5 text-zinc-600 dark:text-zinc-300">
            Year
            <select
              value={/^\d{4}$/.test(periodChoice) ? periodChoice : ""}
              onChange={(e) => {
                const v = e.target.value;
                if (v) setPeriodChoice(v);
              }}
              className="rounded-full border border-zinc-300 bg-white px-2 py-1 text-xs font-medium text-zinc-800 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100"
            >
              <option value="">Select…</option>
              {years.map((y) => (
                <option key={y} value={String(y)}>
                  {y}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-xl bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950/30 dark:text-red-200">{error}</div>
      ) : null}

      {loading && !data ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading realized totals…</p>
      ) : null}

      {data ? (
        <>
          <div className="rounded-xl border border-zinc-300 bg-white p-4 shadow-sm dark:border-white/20 dark:bg-zinc-950">
            <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Grand total · {periodLabel(data.period)}
            </div>
            <div className={"mt-1 text-2xl font-semibold tabular-nums " + tone(data.grandTotal)}>
              {usd(data.grandTotal)}
            </div>
            <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
              {data.bookCount} closed book{data.bookCount === 1 ? "" : "s"}
              {data.skippedOpen > 0 ? ` · ${data.skippedOpen} open excluded` : ""}
              {data.skippedRejected > 0 ? ` · ${data.skippedRejected} rejected excluded` : ""}
              {data.skippedNoRealized > 0
                ? ` · ${data.skippedNoRealized} closed with no matched realized`
                : ""}
            </p>
          </div>

          {data.strategies.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-300 p-4 text-sm text-zinc-600 dark:border-white/20 dark:text-zinc-300">
              No closed option books with computable realized G/L for this period.
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {data.strategies.map((s) => (
                <section
                  key={s.kind}
                  className="rounded-xl border border-zinc-300 bg-white shadow-sm dark:border-white/20 dark:bg-zinc-950"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-zinc-200 px-4 py-3 dark:border-white/15">
                    <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{s.label}</h3>
                    <div className="flex items-baseline gap-3">
                      <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                        {s.bookCount} book{s.bookCount === 1 ? "" : "s"}
                      </span>
                      <span className={"text-sm font-semibold tabular-nums " + tone(s.realized)}>{usd(s.realized)}</span>
                    </div>
                  </div>
                  <ul className="divide-y divide-zinc-200 dark:divide-white/10">
                    {s.underlyings.map((u) => (
                      <li key={u.underlying} className="flex items-baseline justify-between gap-3 px-4 py-2 text-sm">
                        <span className="font-medium text-zinc-800 dark:text-zinc-100">
                          <SymbolLink symbol={u.underlying}>{u.underlying}</SymbolLink>
                          <span className="ml-2 text-[11px] font-normal text-zinc-500 dark:text-zinc-400">
                            {u.bookCount} book{u.bookCount === 1 ? "" : "s"}
                          </span>
                        </span>
                        <span className={"tabular-nums font-medium " + tone(u.realized)}>{usd(u.realized)}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}

          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Period is the book’s close date.
          </p>
        </>
      ) : null}
    </div>
  );
}

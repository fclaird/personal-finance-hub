"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";

import { EditablePageHeading } from "@/app/components/EditableHeading";
import { usePrivacy } from "@/app/components/PrivacyProvider";
import { PERIOD_KINDS, type PeriodKind } from "@/lib/analytics/periodWindows";
import { formatUsd2 } from "@/lib/format";
import { formatDisplayDate } from "@/lib/formatDate";
import { posNegClass } from "@/lib/terminal/colors";

type RealizedGainsByScope = {
  jointBrokerage: number | null;
  retirement: number | null;
  total: number | null;
};

type ReportMetrics = {
  netBalance: number | null;
  plDollars: number | null;
  plPct: number | null;
  realizedGains: RealizedGainsByScope;
  vsSpy: number | null;
  vsQqq: number | null;
};

type ReportTrade = {
  id: string;
  tradeDate: string;
  accountId: string;
  accountLabel: string;
  scope: "joint_brokerage" | "retirement";
  symbol: string | null;
  description: string | null;
  realizedDollars: number | null;
};

type ReportPayload = {
  ok: boolean;
  period?: PeriodKind;
  metrics?: ReportMetrics;
  trades?: ReportTrade[];
  footnotes?: string[];
  error?: string;
};

const PERIOD_LABELS: Record<PeriodKind, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  ytd: "YTD",
};

function formatPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}%`;
}

function usd2Masked(v: number | null | undefined, masked: boolean): string {
  return formatUsd2(v, { mask: masked });
}

function sumScope(trades: ReportTrade[], scope: ReportTrade["scope"]): number | null {
  let sum = 0;
  let saw = false;
  for (const t of trades) {
    if (t.scope !== scope || t.realizedDollars == null || !Number.isFinite(t.realizedDollars)) continue;
    sum += t.realizedDollars;
    saw = true;
  }
  return saw ? Math.round(sum * 100) / 100 : null;
}

function sumAllRealized(trades: ReportTrade[]): number | null {
  let sum = 0;
  let saw = false;
  for (const t of trades) {
    if (t.realizedDollars == null || !Number.isFinite(t.realizedDollars)) continue;
    sum += t.realizedDollars;
    saw = true;
  }
  return saw ? Math.round(sum * 100) / 100 : null;
}

function groupTradesByDay(trades: ReportTrade[]): Array<{ ymd: string; trades: ReportTrade[] }> {
  const byDay = new Map<string, ReportTrade[]>();
  for (const t of trades) {
    const bucket = byDay.get(t.tradeDate) ?? [];
    bucket.push(t);
    byDay.set(t.tradeDate, bucket);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([ymd, dayTrades]) => ({
      ymd,
      trades: dayTrades.sort((a, b) => b.id.localeCompare(a.id)),
    }));
}

function MetricCard({
  title,
  value,
  sub,
  className,
}: {
  title: string;
  value: string;
  sub?: string | null;
  className?: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-200/80 bg-white p-4 shadow-sm dark:border-zinc-700/80 dark:bg-zinc-900/60">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {title}
      </div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums tracking-tight ${className ?? ""}`}>
        {value}
      </div>
      {sub ? <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{sub}</div> : null}
    </div>
  );
}

function ScopeTotalsRow({
  label,
  joint,
  retirement,
  total,
  masked,
  className,
  compact = false,
}: {
  label: string;
  joint: number | null;
  retirement: number | null;
  total: number | null;
  masked: boolean;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={`grid gap-2 text-sm ${
        compact
          ? "grid-cols-3 sm:grid-cols-3"
          : "sm:grid-cols-[minmax(0,1fr)_repeat(3,minmax(5rem,auto))] sm:items-center"
      } ${className ?? ""}`}
    >
      {!compact ? (
        <div className="font-medium text-zinc-700 dark:text-zinc-200">{label}</div>
      ) : null}
      <div className="flex flex-col sm:items-end">
        <span className="text-[10px] uppercase tracking-wide text-zinc-500">Joint</span>
        <span className={`tabular-nums ${posNegClass(joint ?? 0)}`}>{usd2Masked(joint, masked)}</span>
      </div>
      <div className="flex flex-col sm:items-end">
        <span className="text-[10px] uppercase tracking-wide text-zinc-500">Retirement</span>
        <span className={`tabular-nums ${posNegClass(retirement ?? 0)}`}>
          {usd2Masked(retirement, masked)}
        </span>
      </div>
      <div className="flex flex-col sm:items-end">
        <span className="text-[10px] uppercase tracking-wide text-zinc-500">Total</span>
        <span className={`font-semibold tabular-nums ${posNegClass(total ?? 0)}`}>
          {usd2Masked(total, masked)}
        </span>
      </div>
    </div>
  );
}

function RealizedTradeTable({ trades, masked }: { trades: ReportTrade[]; masked: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-zinc-50 text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:bg-zinc-900/80 dark:text-zinc-400">
          <tr>
            <th className="px-3 py-2">Account</th>
            <th className="px-3 py-2">Symbol</th>
            <th className="px-3 py-2">Description</th>
            <th className="px-3 py-2 text-right">Realized</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((t) => (
            <tr key={t.id} className="border-t border-zinc-100 dark:border-zinc-800/80">
              <td className="whitespace-nowrap px-3 py-2 text-zinc-600 dark:text-zinc-300">
                {t.accountLabel}
              </td>
              <td className="px-3 py-2 font-medium">{t.symbol ?? "—"}</td>
              <td className="max-w-md truncate px-3 py-2 text-zinc-600 dark:text-zinc-300">
                {t.description ?? "—"}
              </td>
              <td
                className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${
                  t.realizedDollars != null ? posNegClass(t.realizedDollars) : ""
                }`}
              >
                {t.realizedDollars != null ? usd2Masked(t.realizedDollars, masked) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RealizedTradesSection({
  title,
  trades,
  masked,
  secondary = false,
}: {
  title: string;
  trades: ReportTrade[];
  masked: boolean;
  secondary?: boolean;
}) {
  return (
    <section>
      <h2
        className={`mb-3 text-sm font-semibold uppercase tracking-wide ${
          secondary ? "text-zinc-500 dark:text-zinc-400" : "text-zinc-600 dark:text-zinc-300"
        }`}
      >
        {title}
      </h2>
      {trades.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          No closing trades with realized P&amp;L in this window.{" "}
          <Link href="/connections" className="text-teal-700 underline dark:text-teal-300">
            Sync TRADE history
          </Link>{" "}
          on Connections if you expect activity.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-200/80 dark:border-zinc-700/80">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-zinc-50 text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:bg-zinc-900/80 dark:text-zinc-400">
              <tr>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Account</th>
                <th className="px-3 py-2">Symbol</th>
                <th className="px-3 py-2">Description</th>
                <th className="px-3 py-2 text-right">Realized</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t) => (
                <tr key={t.id} className="border-t border-zinc-100 dark:border-zinc-800/80">
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                    {formatDisplayDate(t.tradeDate, { fallback: t.tradeDate })}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-zinc-600 dark:text-zinc-300">
                    {t.accountLabel}
                  </td>
                  <td className="px-3 py-2 font-medium">{t.symbol ?? "—"}</td>
                  <td className="max-w-md truncate px-3 py-2 text-zinc-600 dark:text-zinc-300">
                    {t.description ?? "—"}
                  </td>
                  <td
                    className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${
                      t.realizedDollars != null ? posNegClass(t.realizedDollars) : ""
                    }`}
                  >
                    {t.realizedDollars != null ? usd2Masked(t.realizedDollars, masked) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function WeeklyRealizedTradesSection({ trades, masked }: { trades: ReportTrade[]; masked: boolean }) {
  const dayGroups = useMemo(() => groupTradesByDay(trades), [trades]);
  const [expandedDays, setExpandedDays] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (dayGroups.length === 0) {
      setExpandedDays(new Set());
      return;
    }
    setExpandedDays(new Set([dayGroups[0]!.ymd]));
  }, [dayGroups]);

  const weekJoint = sumScope(trades, "joint_brokerage");
  const weekRetirement = sumScope(trades, "retirement");
  const weekTotal = sumAllRealized(trades);

  function toggleDay(ymd: string) {
    setExpandedDays((prev) => {
      const next = new Set(prev);
      if (next.has(ymd)) next.delete(ymd);
      else next.add(ymd);
      return next;
    });
  }

  if (trades.length === 0) {
    return (
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-300">
          Weekly realized trades
        </h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          No closing trades with realized P&amp;L this week.{" "}
          <Link href="/connections" className="text-teal-700 underline dark:text-teal-300">
            Sync TRADE history
          </Link>{" "}
          on Connections if you expect activity.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-300">
        Weekly realized trades
      </h2>

      <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/80 p-4 dark:border-zinc-700/80 dark:bg-zinc-900/40">
        <ScopeTotalsRow
          label="Week total"
          joint={weekJoint}
          retirement={weekRetirement}
          total={weekTotal}
          masked={masked}
        />
      </div>

      <div className="space-y-2">
        {dayGroups.map(({ ymd, trades: dayTrades }) => {
          const expanded = expandedDays.has(ymd);
          const dayJoint = sumScope(dayTrades, "joint_brokerage");
          const dayRetirement = sumScope(dayTrades, "retirement");
          const dayTotal = sumAllRealized(dayTrades);
          const dayLabel = formatDisplayDate(ymd, { fallback: ymd });

          return (
            <div
              key={ymd}
              className="overflow-hidden rounded-xl border border-zinc-200/80 dark:border-zinc-700/80"
            >
              <button
                type="button"
                onClick={() => toggleDay(ymd)}
                className="flex w-full flex-col gap-3 bg-white px-4 py-3 text-left transition-colors hover:bg-zinc-50 dark:bg-zinc-900/60 dark:hover:bg-zinc-900/80 sm:gap-2"
                aria-expanded={expanded}
              >
                <div className="flex items-center gap-2">
                  <span className="text-zinc-400" aria-hidden>
                    {expanded ? "▾" : "▸"}
                  </span>
                  <span className="font-medium text-zinc-800 dark:text-zinc-100">{dayLabel}</span>
                  <span className="text-xs text-zinc-500">
                    {dayTrades.length} trade{dayTrades.length === 1 ? "" : "s"}
                  </span>
                </div>
                <ScopeTotalsRow
                  label=""
                  joint={dayJoint}
                  retirement={dayRetirement}
                  total={dayTotal}
                  masked={masked}
                  compact
                  className="pl-6 sm:pl-7"
                />
              </button>
              {expanded ? (
                <div className="border-t border-zinc-100 bg-white dark:border-zinc-800/80 dark:bg-zinc-950/40">
                  <RealizedTradeTable trades={dayTrades} masked={masked} />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ReportsPageInner() {
  const privacy = usePrivacy();
  const router = useRouter();
  const searchParams = useSearchParams();
  const periodParam = searchParams.get("period");
  const period: PeriodKind = PERIOD_KINDS.includes(periodParam as PeriodKind)
    ? (periodParam as PeriodKind)
    : "daily";

  const [data, setData] = useState<ReportPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const resp = await fetch(`/api/reports?period=${encodeURIComponent(period)}`, { cache: "no-store" });
        const json = (await resp.json()) as ReportPayload;
        if (!cancelled) {
          if (json.ok) setData(json);
          else setError(json.error ?? "Failed to load report");
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [period]);

  const metrics = data?.metrics;
  const trades = data?.trades ?? [];
  const footnotes = data?.footnotes ?? [];
  const realized = metrics?.realizedGains;

  const plSub = useMemo(() => {
    if (metrics?.plPct == null) return null;
    return formatPct(metrics.plPct);
  }, [metrics?.plPct]);

  function setPeriod(next: PeriodKind) {
    router.replace(`/reports?period=${next}`);
  }

  const jointTrades = trades.filter((t) => t.scope === "joint_brokerage");
  const retirementTrades = trades.filter((t) => t.scope === "retirement");

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6">
      <EditablePageHeading pageId="reports" defaultTitle="Reports" />

      <div className="flex flex-wrap gap-2">
        {PERIOD_KINDS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPeriod(p)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              period === p
                ? "bg-teal-700 text-white dark:bg-teal-600"
                : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
            }`}
          >
            {PERIOD_LABELS[p]}
          </button>
        ))}
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </div>
      ) : null}

      {loading && !data ? (
        <div className="text-sm text-zinc-500 dark:text-zinc-400">Loading report…</div>
      ) : null}

      {metrics && realized ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <MetricCard
              title="Net portfolio balance"
              value={usd2Masked(metrics.netBalance, privacy.masked)}
            />
            <MetricCard
              title="Period P&L"
              value={usd2Masked(metrics.plDollars, privacy.masked)}
              sub={plSub}
              className={posNegClass(metrics.plDollars ?? 0)}
            />
            <MetricCard
              title="Joint brokerage realized"
              value={usd2Masked(realized.jointBrokerage, privacy.masked)}
              className={posNegClass(realized.jointBrokerage ?? 0)}
            />
            <MetricCard
              title="Retirement realized"
              value={usd2Masked(realized.retirement, privacy.masked)}
              sub="Secondary"
              className={posNegClass(realized.retirement ?? 0)}
            />
            <MetricCard
              title="vs SPY"
              value={formatPct(metrics.vsSpy)}
              className={posNegClass(metrics.vsSpy ?? 0)}
            />
            <MetricCard
              title="vs QQQ"
              value={formatPct(metrics.vsQqq)}
              className={posNegClass(metrics.vsQqq ?? 0)}
            />
          </div>

          {(period === "monthly" || period === "ytd") && realized.total != null ? (
            <p className="text-sm text-zinc-600 dark:text-zinc-300">
              Realized gains total:{" "}
              <span className={`font-medium tabular-nums ${posNegClass(realized.total)}`}>
                {usd2Masked(realized.total, privacy.masked)}
              </span>
              {" · "}
              Switch to Daily or Weekly for the trade list.
            </p>
          ) : null}

          {footnotes.length > 0 ? (
            <ul className="list-inside list-disc space-y-1 text-xs text-zinc-500 dark:text-zinc-400">
              {footnotes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          ) : null}

          {period === "daily" ? (
            <>
              <RealizedTradesSection
                title="Joint brokerage — realized trades"
                trades={jointTrades}
                masked={privacy.masked}
              />
              <RealizedTradesSection
                title="Retirement — realized trades"
                trades={retirementTrades}
                masked={privacy.masked}
                secondary
              />
            </>
          ) : null}

          {period === "weekly" ? (
            <WeeklyRealizedTradesSection trades={trades} masked={privacy.masked} />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export default function ReportsPage() {
  return (
    <Suspense fallback={<div className="px-4 py-6 text-sm text-zinc-500">Loading…</div>}>
      <ReportsPageInner />
    </Suspense>
  );
}

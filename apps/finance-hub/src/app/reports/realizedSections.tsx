"use client";

import Link from "next/link";
import { useMemo, useState, useSyncExternalStore } from "react";

import {
  ROLLING_WEEK_LABELS,
  daySlotsForDisplay,
  formatMonthDayRange,
  formatWeekdayDateLabel,
  futuresWeekContaining,
  monthKeyForTrade,
  rollingFuturesWeeks,
  sessionYmdForTrade,
  tradeFallsInWeeks,
  weekendSessionTrades,
  ytdMonthsThrough,
  type FuturesDaySlot,
} from "@/lib/analytics/futuresWeek";
import { mostRecentActiveKey } from "@/lib/analytics/reportActivityRows";
import { formatUsd2 } from "@/lib/format";
import { nyYmd } from "@/lib/market/usEquitySession";
import { posNegClass } from "@/lib/terminal/colors";

export type ReportTrade = {
  id: string;
  tradeDate: string;
  tradedAt?: string | null;
  accountId: string;
  accountLabel: string;
  scope: "joint_brokerage" | "retirement";
  symbol: string | null;
  description: string | null;
  realizedDollars: number | null;
};

const SHOW_WEEKEND_KEY = "fh-reports-show-weekend";

function usd2Masked(v: number | null | undefined, masked: boolean): string {
  return formatUsd2(v, { mask: masked });
}

function sumScope(trades: ReportTrade[], scope: ReportTrade["scope"]): number | null {
  let sum = 0;
  let saw = false;
  for (const trade of trades) {
    if (trade.scope !== scope || trade.realizedDollars == null || !Number.isFinite(trade.realizedDollars)) continue;
    sum += trade.realizedDollars;
    saw = true;
  }
  return saw ? Math.round(sum * 100) / 100 : null;
}

function sumAllRealized(trades: ReportTrade[]): number | null {
  let sum = 0;
  let saw = false;
  for (const trade of trades) {
    if (trade.realizedDollars == null || !Number.isFinite(trade.realizedDollars)) continue;
    sum += trade.realizedDollars;
    saw = true;
  }
  return saw ? Math.round(sum * 100) / 100 : null;
}

function scopeTotals(trades: ReportTrade[]): { joint: number; retirement: number; total: number } {
  return {
    joint: sumScope(trades, "joint_brokerage") ?? 0,
    retirement: sumScope(trades, "retirement") ?? 0,
    total: sumAllRealized(trades) ?? 0,
  };
}

function sortTrades(trades: ReportTrade[]): ReportTrade[] {
  return [...trades].sort((a, b) => {
    const at = a.tradedAt ?? a.tradeDate;
    const bt = b.tradedAt ?? b.tradeDate;
    return bt.localeCompare(at) || b.id.localeCompare(a.id);
  });
}

function readShowWeekend(): boolean {
  try {
    return window.localStorage.getItem(SHOW_WEEKEND_KEY) === "1";
  } catch {
    return false;
  }
}

function subscribeShowWeekend(onStoreChange: () => void): () => void {
  window.addEventListener(SHOW_WEEKEND_KEY, onStoreChange);
  return () => window.removeEventListener(SHOW_WEEKEND_KEY, onStoreChange);
}

function useShowWeekend(): [boolean, (next: boolean) => void] {
  const on = useSyncExternalStore(subscribeShowWeekend, readShowWeekend, () => false);
  function update(next: boolean) {
    try {
      window.localStorage.setItem(SHOW_WEEKEND_KEY, next ? "1" : "0");
    } catch {
      /* storage unavailable */
    }
    window.dispatchEvent(new Event(SHOW_WEEKEND_KEY));
  }
  return [on, update];
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
  joint: number;
  retirement: number;
  total: number;
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
      {!compact ? <div className="font-medium text-zinc-700 dark:text-zinc-200">{label}</div> : null}
      <div className="flex flex-col sm:items-end">
        <span className="text-[10px] uppercase tracking-wide text-zinc-500">Joint</span>
        <span className={`tabular-nums ${posNegClass(joint)}`}>{usd2Masked(joint, masked)}</span>
      </div>
      <div className="flex flex-col sm:items-end">
        <span className="text-[10px] uppercase tracking-wide text-zinc-500">Retirement</span>
        <span className={`tabular-nums ${posNegClass(retirement)}`}>{usd2Masked(retirement, masked)}</span>
      </div>
      <div className="flex flex-col sm:items-end">
        <span className="text-[10px] uppercase tracking-wide text-zinc-500">Total</span>
        <span className={`font-semibold tabular-nums ${posNegClass(total)}`}>{usd2Masked(total, masked)}</span>
      </div>
    </div>
  );
}

function RealizedTradeTable({ trades, masked }: { trades: ReportTrade[]; masked: boolean }) {
  const rows = sortTrades(trades);
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
          {rows.map((trade) => (
            <tr key={trade.id} className="border-t border-zinc-100 dark:border-zinc-800/80">
              <td className="whitespace-nowrap px-3 py-2 text-zinc-600 dark:text-zinc-300">{trade.accountLabel}</td>
              <td className="px-3 py-2 font-medium">{trade.symbol ?? "—"}</td>
              <td className="max-w-md truncate px-3 py-2 text-zinc-600 dark:text-zinc-300">
                {trade.description ?? "—"}
              </td>
              <td
                className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${
                  trade.realizedDollars != null ? posNegClass(trade.realizedDollars) : ""
                }`}
              >
                {trade.realizedDollars != null ? usd2Masked(trade.realizedDollars, masked) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ShowWeekendToggle({ on, onChange }: { on: boolean; onChange: (next: boolean) => void }) {
  return (
    <label className="inline-flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300">
      <input
        type="checkbox"
        checked={on}
        onChange={(event) => onChange(event.target.checked)}
        className="size-4 rounded border-zinc-300 text-teal-700 focus:ring-teal-600"
      />
      Show weekend
    </label>
  );
}

function HiddenWeekendNote({ trades, masked }: { trades: ReportTrade[]; masked: boolean }) {
  if (trades.length === 0) return null;
  const total = sumAllRealized(trades) ?? 0;
  const noun = trades.length === 1 ? "trade" : "trades";
  return (
    <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
      Includes {usd2Masked(total, masked)} from {trades.length} weekend {noun}. Show weekend lists them.
    </p>
  );
}

function EmptyLedgerHint() {
  return (
    <p className="text-sm text-zinc-500 dark:text-zinc-400">
      No closing trades with realized P&amp;L in this window.{" "}
      <Link href="/connections" className="text-teal-700 underline dark:text-teal-300">
        Sync TRADE history
      </Link>{" "}
      on Connections if you expect activity.
    </p>
  );
}

function QuietRow({ label, aside }: { label: string; aside?: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-zinc-200/80 bg-white px-4 py-2 dark:border-zinc-700/80 dark:bg-zinc-900/60">
      <span className="font-medium text-zinc-800 dark:text-zinc-100">{label}</span>
      {aside ? <span className="text-sm text-zinc-500">{aside}</span> : null}
      <span className="ml-auto shrink-0 text-sm text-zinc-500">No trades</span>
    </div>
  );
}

function SummaryCard({
  label,
  aside,
  trades,
  masked,
}: {
  label: string;
  aside?: string;
  trades: ReportTrade[];
  masked: boolean;
}) {
  if (trades.length === 0) return <QuietRow label={label} aside={aside} />;
  const totals = scopeTotals(trades);
  return (
    <div className="flex w-full flex-col gap-3 rounded-xl border border-zinc-200/80 bg-white px-4 py-3 dark:border-zinc-700/80 dark:bg-zinc-900/60 sm:gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-zinc-800 dark:text-zinc-100">{label}</span>
        {aside ? <span className="text-sm text-zinc-500">{aside}</span> : null}
        <span className="text-xs text-zinc-500">
          {trades.length} trade{trades.length === 1 ? "" : "s"}
        </span>
      </div>
      <ScopeTotalsRow
        label=""
        joint={totals.joint}
        retirement={totals.retirement}
        total={totals.total}
        masked={masked}
        compact
      />
    </div>
  );
}

function DayCard({
  ymd,
  trades,
  masked,
  expanded,
  onToggle,
}: {
  ymd: string;
  trades: ReportTrade[];
  masked: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  if (trades.length === 0) return <QuietRow label={formatWeekdayDateLabel(ymd)} />;
  const totals = scopeTotals(trades);
  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200/80 dark:border-zinc-700/80">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full flex-col gap-3 bg-white px-4 py-3 text-left transition-colors hover:bg-zinc-50 dark:bg-zinc-900/60 dark:hover:bg-zinc-900/80 sm:gap-2"
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-2">
          <span className="text-zinc-400" aria-hidden>
            {expanded ? "▾" : "▸"}
          </span>
          <span className="font-medium text-zinc-800 dark:text-zinc-100">{formatWeekdayDateLabel(ymd)}</span>
          <span className="text-xs text-zinc-500">
            {trades.length} trade{trades.length === 1 ? "" : "s"}
          </span>
        </div>
        <ScopeTotalsRow
          label=""
          joint={totals.joint}
          retirement={totals.retirement}
          total={totals.total}
          masked={masked}
          compact
          className="pl-6 sm:pl-7"
        />
      </button>
      {expanded ? (
        <div className="border-t border-zinc-100 bg-white dark:border-zinc-800/80 dark:bg-zinc-950/40">
          <RealizedTradeTable trades={trades} masked={masked} />
        </div>
      ) : null}
    </div>
  );
}

function DayList({
  days,
  trades,
  masked,
  expandedDays,
  onToggleDay,
}: {
  days: readonly FuturesDaySlot[];
  trades: ReportTrade[];
  masked: boolean;
  expandedDays: ReadonlySet<string>;
  onToggleDay: (ymd: string) => void;
}) {
  const byDay = useMemo(() => {
    const map = new Map<string, ReportTrade[]>();
    for (const trade of trades) {
      const ymd = sessionYmdForTrade(trade);
      const bucket = map.get(ymd);
      if (bucket) bucket.push(trade);
      else map.set(ymd, [trade]);
    }
    return map;
  }, [trades]);

  return (
    <div className="space-y-2">
      {days.map((day) => (
        <DayCard
          key={day.ymd}
          ymd={day.ymd}
          trades={byDay.get(day.ymd) ?? []}
          masked={masked}
          expanded={expandedDays.has(day.ymd)}
          onToggle={() => onToggleDay(day.ymd)}
        />
      ))}
    </div>
  );
}

function activeDayKey(days: readonly FuturesDaySlot[], trades: readonly ReportTrade[], showWeekend: boolean): string | null {
  return mostRecentActiveKey(
    days
      .filter((day) => showWeekend || !day.weekend)
      .map((day) => ({
        key: day.ymd,
        tradeCount: trades.filter((trade) => sessionYmdForTrade(trade) === day.ymd).length,
      })),
  );
}

function SectionHeading({ title, showWeekend, onToggleWeekend }: { title: string; showWeekend: boolean; onToggleWeekend: (next: boolean) => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-300">{title}</h2>
      <ShowWeekendToggle on={showWeekend} onChange={onToggleWeekend} />
    </div>
  );
}

export function WeeklyRealizedTradesSection({ trades, masked }: { trades: ReportTrade[]; masked: boolean }) {
  const [showWeekend, setShowWeekend] = useShowWeekend();
  const week = useMemo(() => futuresWeekContaining(new Date()), []);
  const weekTrades = useMemo(() => trades.filter((trade) => tradeFallsInWeeks(trade, [week])), [trades, week]);
  const visibleDays = useMemo(() => daySlotsForDisplay(week.days, showWeekend), [week, showWeekend]);
  const hiddenWeekend = showWeekend ? [] : weekendSessionTrades(weekTrades, week.days);
  const totals = scopeTotals(weekTrades);
  const [expandedDays, setExpandedDays] = useState<Set<string>>(() => {
    const open = activeDayKey(week.days, weekTrades, showWeekend);
    return new Set(open ? [open] : []);
  });

  function toggleDay(ymd: string) {
    setExpandedDays((prev) => {
      const next = new Set(prev);
      if (next.has(ymd)) next.delete(ymd);
      else next.add(ymd);
      return next;
    });
  }

  return (
    <section className="space-y-4">
      <SectionHeading title="Weekly realized trades" showWeekend={showWeekend} onToggleWeekend={setShowWeekend} />
      {weekTrades.length === 0 ? <EmptyLedgerHint /> : null}
      <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/80 p-4 dark:border-zinc-700/80 dark:bg-zinc-900/40">
        <ScopeTotalsRow
          label="Week total"
          joint={totals.joint}
          retirement={totals.retirement}
          total={totals.total}
          masked={masked}
        />
        <HiddenWeekendNote trades={hiddenWeekend} masked={masked} />
      </div>
      <DayList
        days={visibleDays}
        trades={weekTrades}
        masked={masked}
        expandedDays={expandedDays}
        onToggleDay={toggleDay}
      />
    </section>
  );
}

function SectionTitle({ title }: { title: string }) {
  return <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-300">{title}</h2>;
}

export function MonthlyRealizedTradesSection({ trades, masked }: { trades: ReportTrade[]; masked: boolean }) {
  const weeks = useMemo(() => rollingFuturesWeeks(new Date(), 5), []);
  const scoped = useMemo(() => trades.filter((trade) => tradeFallsInWeeks(trade, weeks)), [trades, weeks]);
  const totals = scopeTotals(scoped);

  return (
    <section className="space-y-4">
      <SectionTitle title="Monthly realized trades (last 5 weeks)" />
      {scoped.length === 0 ? <EmptyLedgerHint /> : null}
      <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/80 p-4 dark:border-zinc-700/80 dark:bg-zinc-900/40">
        <ScopeTotalsRow
          label="5-week total"
          joint={totals.joint}
          retirement={totals.retirement}
          total={totals.total}
          masked={masked}
        />
      </div>
      <div className="space-y-2">
        {weeks.map((week, index) => {
          const weekTrades = scoped.filter((trade) => tradeFallsInWeeks(trade, [week]));
          return (
            <SummaryCard
              key={week.mondayYmd}
              label={ROLLING_WEEK_LABELS[index] ?? `Week ${index + 1}`}
              aside={formatMonthDayRange(week.mondayYmd, week.closeSundayYmd)}
              trades={weekTrades}
              masked={masked}
            />
          );
        })}
      </div>
    </section>
  );
}

function monthTrades(trades: ReportTrade[], monthKey: string, throughYmd: string): ReportTrade[] {
  return trades.filter((trade) => monthKeyForTrade(trade, throughYmd) === monthKey);
}

export function YtdRealizedTradesSection({ trades, masked }: { trades: ReportTrade[]; masked: boolean }) {
  const todayYmd = nyYmd(new Date());
  const months = useMemo(() => ytdMonthsThrough(new Date()), []);

  return (
    <section className="space-y-4">
      <SectionTitle title="Realized by month" />
      <div className="space-y-2">
        {months.map((month) => (
          <SummaryCard
            key={month.key}
            label={month.label}
            trades={monthTrades(trades, month.key, todayYmd)}
            masked={masked}
          />
        ))}
      </div>
    </section>
  );
}

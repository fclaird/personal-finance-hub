"use client";

import Link from "next/link";
import { Fragment, useMemo, useState, useSyncExternalStore } from "react";

import {
  ROLLING_WEEK_LABELS,
  daySlotsForDisplay,
  formatMonthDayRange,
  formatWeekdayDateLabel,
  futuresWeekContaining,
  monthKeyForTrade,
  monthWeekPortions,
  rollingFuturesWeeks,
  sessionYmdForTrade,
  tradeFallsInWeeks,
  weekendSessionTrades,
  ytdMonthsThrough,
  type FuturesDaySlot,
} from "@/lib/analytics/futuresWeek";
import { mostRecentActiveKey, tradeCountLabel, winLossLabel } from "@/lib/analytics/reportActivityRows";
import { formatUsd2 } from "@/lib/format";
import { nyYmd } from "@/lib/market/usEquitySession";
import { posNegClass } from "@/lib/terminal/colors";

export type ReportTrade = {
  id: string;
  tradeDate: string;
  tradedAt?: string | null;
  accountId: string;
  accountLabel: string;
  symbol: string | null;
  description: string | null;
  realizedDollars: number | null;
};

const SHOW_WEEKEND_KEY = "fh-reports-show-weekend";

/** Reports-only rules. Dark mode uses an opaque white tint so lines stay visible on black. */
const REPORT_FRAME = "border-zinc-300 dark:border-white/25";
const REPORT_RULE = "border-zinc-200 dark:border-white/20";
const REPORT_HEADER_RULE = "border-zinc-400 dark:border-white/40";

function usd2Masked(v: number | null | undefined, masked: boolean): string {
  return formatUsd2(v, { mask: masked });
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

function TradeCountDetail({ trades }: { trades: ReportTrade[] }) {
  if (trades.length === 0) return null;
  return (
    <span className="whitespace-nowrap text-sm text-zinc-500 dark:text-zinc-300">
      {tradeCountLabel(trades.length)}
      <span className="mx-1.5 text-zinc-300 dark:text-white/30">·</span>
      {winLossLabel(trades)}
    </span>
  );
}

function RealizedTotalBar({ label, trades, masked }: { label: string; trades: ReportTrade[]; masked: boolean }) {
  const amount = sumAllRealized(trades) ?? 0;
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <div className="font-medium text-zinc-700 dark:text-zinc-200">{label}</div>
      <div className="flex items-center gap-4">
        {trades.length === 0 ? <span className="text-sm text-zinc-500">No trades</span> : <TradeCountDetail trades={trades} />}
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wide text-zinc-500">Realized</div>
          <div className={`font-semibold tabular-nums ${posNegClass(amount)}`}>{usd2Masked(amount, masked)}</div>
        </div>
      </div>
    </div>
  );
}

function RealizedTradeTable({ trades, masked }: { trades: ReportTrade[]; masked: boolean }) {
  const rows = sortTrades(trades);
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border-collapse text-left text-sm">
        <thead className={`border-b ${REPORT_HEADER_RULE} bg-zinc-50 text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:bg-zinc-900/80 dark:text-zinc-400`}>
          <tr>
            <th className="px-3 py-2">Account</th>
            <th className="px-3 py-2">Symbol</th>
            <th className="px-3 py-2">Description</th>
            <th className="px-3 py-2 text-right">Realized</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((trade) => (
            <tr key={trade.id} className={`border-t ${REPORT_RULE}`}>
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
    <div className={`flex items-center gap-2 rounded-xl border ${REPORT_FRAME} bg-white px-4 py-2 dark:bg-zinc-900/60`}>
      <span className="font-medium text-zinc-800 dark:text-zinc-100">{label}</span>
      {aside ? <span className="text-sm text-zinc-500">{aside}</span> : null}
      <span className="ml-auto shrink-0 text-sm text-zinc-500">No trades</span>
    </div>
  );
}

function SummaryTable({
  rows,
  masked,
}: {
  rows: { key: string; label: string; aside?: string; trades: ReportTrade[] }[];
  masked: boolean;
}) {
  return (
    <div className={`overflow-hidden rounded-xl border ${REPORT_FRAME}`}>
      <table className="w-full border-collapse text-sm">
        <thead className={`border-b ${REPORT_HEADER_RULE} bg-zinc-50 text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:bg-zinc-900/80 dark:text-zinc-400`}>
          <tr>
            <th className="px-3 py-0.5 text-left font-semibold">
              <span className="sr-only">Period</span>
            </th>
            <th className="px-3 py-0.5 text-right font-semibold">Trades</th>
            <th className="w-28 px-3 py-0.5 text-right font-semibold">Realized</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const amount = sumAllRealized(row.trades);
            return (
              <tr key={row.key} className={`border-t ${REPORT_RULE}`}>
                <td className="whitespace-nowrap px-3 py-0.5 font-medium text-zinc-800 dark:text-zinc-100">
                  {row.label}
                  {row.aside ? <span className="font-normal text-zinc-500"> {row.aside}</span> : null}
                </td>
                {amount == null ? (
                  <td colSpan={2} className="whitespace-nowrap px-3 py-0.5 text-right text-zinc-500">
                    No trades
                  </td>
                ) : (
                  <>
                    <td className="whitespace-nowrap px-3 py-0.5 text-right">
                      <TradeCountDetail trades={row.trades} />
                    </td>
                    <td className={`whitespace-nowrap px-3 py-0.5 text-right font-semibold tabular-nums ${posNegClass(amount)}`}>
                      {usd2Masked(amount, masked)}
                    </td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
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
  const amount = sumAllRealized(trades) ?? 0;
  return (
    <div className={`overflow-hidden rounded-xl border ${REPORT_FRAME}`}>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 bg-white px-4 py-3 text-left transition-colors hover:bg-zinc-50 dark:bg-zinc-900/60 dark:hover:bg-zinc-900/80"
        aria-expanded={expanded}
      >
        <span className="text-zinc-400" aria-hidden>
          {expanded ? "▾" : "▸"}
        </span>
        <span className="font-medium text-zinc-800 dark:text-zinc-100">{formatWeekdayDateLabel(ymd)}</span>
        <span className="ml-auto">
          <TradeCountDetail trades={trades} />
        </span>
        <span className={`font-semibold tabular-nums ${posNegClass(amount)}`}>{usd2Masked(amount, masked)}</span>
      </button>
      {expanded ? (
        <div className={`border-t ${REPORT_HEADER_RULE} bg-white dark:bg-zinc-950/40`}>
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
      <div className={`rounded-xl border ${REPORT_HEADER_RULE} bg-zinc-50/80 p-4 dark:bg-zinc-900/40`}>
        <RealizedTotalBar label="Week total" trades={weekTrades} masked={masked} />
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
  return (
    <section className="space-y-4">
      <SectionTitle title="Monthly realized trades (last 5 weeks)" />
      {scoped.length === 0 ? <EmptyLedgerHint /> : null}
      <div className={`rounded-xl border ${REPORT_HEADER_RULE} bg-zinc-50/80 p-4 dark:bg-zinc-900/40`}>
        <RealizedTotalBar label="5-week total" trades={scoped} masked={masked} />
      </div>
      <SummaryTable
        masked={masked}
        rows={weeks.map((week, index) => ({
          key: week.mondayYmd,
          label: ROLLING_WEEK_LABELS[index] ?? `Week ${index + 1}`,
          aside: formatMonthDayRange(week.mondayYmd, week.closeSundayYmd),
          trades: scoped.filter((trade) => tradeFallsInWeeks(trade, [week])),
        }))}
      />
    </section>
  );
}

function monthTrades(trades: ReportTrade[], monthKey: string, throughYmd: string): ReportTrade[] {
  return trades.filter((trade) => monthKeyForTrade(trade, throughYmd) === monthKey);
}

export function YtdRealizedTradesSection({ trades, masked }: { trades: ReportTrade[]; masked: boolean }) {
  const todayYmd = nyYmd(new Date());
  const months = useMemo(() => ytdMonthsThrough(new Date()), []);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  function toggleMonth(monthKey: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(monthKey)) next.delete(monthKey);
      else next.add(monthKey);
      return next;
    });
  }

  return (
    <section className="space-y-1">
      <SectionTitle title="Realized by month" />
      <div className={`overflow-hidden rounded-xl border ${REPORT_FRAME}`}>
        <table className="w-full border-collapse text-sm">
          <thead className={`border-b ${REPORT_HEADER_RULE} bg-zinc-50 text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:bg-zinc-900/80 dark:text-zinc-400`}>
            <tr>
              <th className="px-3 py-0.5 text-left font-semibold">
                <span className="sr-only">Period</span>
              </th>
              <th className="px-3 py-0.5 text-right font-semibold">Trades</th>
              <th className="w-28 px-3 py-0.5 text-right font-semibold">Realized</th>
            </tr>
          </thead>
          <tbody>
            {months.map((month) => {
              const rows = monthTrades(trades, month.key, todayYmd);
              const amount = sumAllRealized(rows);
              const open = expanded.has(month.key);
              if (amount == null) {
                return (
                  <tr key={month.key} className={`border-t ${REPORT_RULE}`}>
                    <td className="whitespace-nowrap px-3 py-0.5 font-medium text-zinc-800 dark:text-zinc-100">{month.label}</td>
                    <td colSpan={2} className="whitespace-nowrap px-3 py-0.5 text-right text-zinc-500">
                      No trades
                    </td>
                  </tr>
                );
              }
              const portions = monthWeekPortions(month.year, month.month, trades, todayYmd);
              return (
                <Fragment key={month.key}>
                  <tr
                    className={`cursor-pointer border-t ${REPORT_RULE} hover:bg-zinc-50 dark:hover:bg-zinc-900/80`}
                    role="button"
                    tabIndex={0}
                    aria-expanded={open}
                    onClick={() => toggleMonth(month.key)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        toggleMonth(month.key);
                      }
                    }}
                  >
                    <td className="whitespace-nowrap px-3 py-0.5 font-medium text-zinc-800 dark:text-zinc-100">
                      <span className="mr-2 inline-block w-3 text-zinc-400" aria-hidden>
                        {open ? "▾" : "▸"}
                      </span>
                      {month.label}
                    </td>
                    <td className="whitespace-nowrap px-3 py-0.5 text-right">
                      <TradeCountDetail trades={rows} />
                    </td>
                    <td className={`whitespace-nowrap px-3 py-0.5 text-right font-semibold tabular-nums ${posNegClass(amount)}`}>
                      {usd2Masked(amount, masked)}
                    </td>
                  </tr>
                  {open
                    ? portions.map((portion) => {
                        const weekAmount = sumAllRealized(portion.trades);
                        return (
                          <tr key={portion.key} className={`border-t ${REPORT_RULE}`}>
                            <td className="whitespace-nowrap py-0.5 pl-8 pr-3 text-zinc-700 dark:text-zinc-200">{portion.label}</td>
                            {weekAmount == null ? (
                              <td colSpan={2} className="whitespace-nowrap px-3 py-0.5 text-right text-zinc-500">
                                No trades
                              </td>
                            ) : (
                              <>
                                <td className="whitespace-nowrap px-3 py-0.5 text-right">
                                  <TradeCountDetail trades={portion.trades} />
                                </td>
                                <td
                                  className={`whitespace-nowrap px-3 py-0.5 text-right font-semibold tabular-nums ${posNegClass(weekAmount)}`}
                                >
                                  {usd2Masked(weekAmount, masked)}
                                </td>
                              </>
                            )}
                          </tr>
                        );
                      })
                    : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

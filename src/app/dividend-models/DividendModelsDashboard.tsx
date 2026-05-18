"use client";

import { useMemo } from "react";
import { Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, Treemap, XAxis, YAxis } from "recharts";

import type { PortfolioDashboard } from "@/lib/dividendModels/dashboardMetrics";
import { assignEarthToneColorsBySymbols, distinctColorForIndex, EARTH_TONE_PIE_COLORS } from "@/lib/charts/pieEarthTones";
import { formatUsd2 } from "@/lib/format";

function usd(v: number | null, mask: boolean) {
  if (v == null || !Number.isFinite(v)) return "—";
  return formatUsd2(v, { mask });
}

function pct(v: number | null) {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(1)}%`;
}

function num(v: number | null, d = 2) {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
}

type Props = {
  dashboard: PortfolioDashboard | null;
  masked: boolean;
};

export function DividendModelsDashboard({ dashboard, masked }: Props) {
  const treemapData = useMemo(() => {
    const rows = [...(dashboard?.treemap ?? [])].sort((a, b) => a.symbol.localeCompare(b.symbol));
    const colorBySym = assignEarthToneColorsBySymbols(rows.map((t) => t.symbol));
    return rows.map((t) => ({
      name: `${t.symbol}\n${usd(t.value, masked)}`,
      size: t.value,
      fill: colorBySym.get(t.symbol) ?? distinctColorForIndex(0),
    }));
  }, [dashboard?.treemap, masked]);

  const cumData = useMemo(
    () =>
      (dashboard?.cumulativeDividends ?? []).map((r) => ({
        month: r.month,
        cumulative: r.cumulative,
        amount: r.amount,
      })),
    [dashboard?.cumulativeDividends],
  );

  if (!dashboard || dashboard.totalPositions === 0) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-500/60 bg-zinc-950/40 px-6 py-12 text-center text-[15px] leading-relaxed text-zinc-300">
        Add symbols to this portfolio, set share counts, and build history to populate the overview (income and cumulative
        dividends use simulated monthly payouts from your holdings).
      </div>
    );
  }

  const d = dashboard;

  return (
    <div className="grid gap-6">

      <div className="grid gap-5 rounded-xl border border-zinc-600/80 bg-zinc-950 p-5 shadow-lg sm:grid-cols-2 sm:p-6 lg:grid-cols-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-widest text-amber-200/95">Portfolio</div>
          <div className="mt-3 grid gap-0">
            <div className="flex min-h-10 items-center justify-between gap-4 border-b border-zinc-700/80 py-2">
              <span className="text-sm text-zinc-400">Total positions</span>
              <span className="text-sm font-medium tabular-nums text-zinc-100">{d.totalPositions}</span>
            </div>
            <div className="flex min-h-10 items-center justify-between gap-4 border-b border-zinc-700/80 py-2">
              <span className="text-sm text-zinc-400">Total shares</span>
              <span className="text-sm font-medium tabular-nums text-zinc-100">{num(d.totalShares, 4)}</span>
            </div>
            <div className="flex min-h-10 items-center justify-between gap-4 border-b border-zinc-700/80 py-2">
              <span className="text-sm text-zinc-400">Total value</span>
              <span className="text-sm font-semibold tabular-nums text-amber-50">{usd(d.totalValue, masked)}</span>
            </div>
            <div className="flex min-h-10 items-center justify-between gap-4 border-b border-zinc-700/80 py-2">
              <span className="text-sm text-zinc-400">Largest</span>
              <span className="text-sm font-medium tabular-nums text-zinc-100">{d.largest ? `${d.largest.symbol} (${pct(d.largest.pct)})` : "—"}</span>
            </div>
            <div className="flex min-h-10 items-center justify-between gap-4 py-2">
              <span className="text-sm text-zinc-400">Smallest</span>
              <span className="text-sm font-medium tabular-nums text-zinc-100">{d.smallest ? `${d.smallest.symbol} (${pct(d.smallest.pct)})` : "—"}</span>
            </div>
          </div>
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-widest text-cyan-200/95">Income</div>
          <div className="mt-3 grid gap-0">
            <div className="flex min-h-10 items-center justify-between gap-4 border-b border-zinc-700/80 py-2">
              <span className="text-sm text-zinc-400">All-time</span>
              <span className="text-sm font-medium tabular-nums text-zinc-100">{usd(d.income.allTime, masked)}</span>
            </div>
            <div className="flex min-h-10 items-center justify-between gap-4 border-b border-zinc-700/80 py-2">
              <span className="text-sm text-zinc-400">YTD</span>
              <span className="text-sm font-medium tabular-nums text-zinc-100">{usd(d.income.ytd, masked)}</span>
            </div>
            <div className="flex min-h-10 items-center justify-between gap-4 border-b border-zinc-700/80 py-2">
              <span className="text-sm text-zinc-400">Last 30 days</span>
              <span className="text-sm font-medium tabular-nums text-zinc-100">{usd(d.income.last30d, masked)}</span>
            </div>
            <div className="flex min-h-10 items-center justify-between gap-4 border-b border-zinc-700/80 py-2">
              <span className="text-sm text-zinc-400">Last 7 days</span>
              <span className="text-sm font-medium tabular-nums text-zinc-100">{usd(d.income.last7d, masked)}</span>
            </div>
            <div className="flex min-h-10 items-center justify-between gap-4 py-2">
              <span className="text-sm text-zinc-400"># payments</span>
              <span className="text-sm font-medium tabular-nums text-zinc-100">{d.income.paymentCount}</span>
            </div>
          </div>
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-widest text-amber-200/95">Growth</div>
          <div className="mt-3 grid gap-0">
            <div className="flex min-h-10 items-center justify-between gap-4 border-b border-zinc-700/80 py-2">
              <span className="text-sm text-zinc-400">DRIP shares</span>
              <span className="text-sm font-medium tabular-nums text-zinc-100">{num(d.growth.dripShares, 4)}</span>
            </div>
            <div className="flex min-h-10 items-center justify-between gap-4 border-b border-zinc-700/80 py-2">
              <span className="text-sm text-zinc-400">Avg days btwn pmts</span>
              <span className="text-sm font-medium tabular-nums text-zinc-100">{d.growth.avgDaysBetweenPayments != null ? num(d.growth.avgDaysBetweenPayments, 1) : "—"}</span>
            </div>
            <div className="flex min-h-10 items-center justify-between gap-4 border-b border-zinc-700/80 py-2">
              <span className="text-sm text-zinc-400">Avg wk contribution</span>
              <span className="text-sm font-medium tabular-nums text-zinc-100">{usd(d.growth.avgWeeklyContribution, masked)}</span>
            </div>
            <div className="flex min-h-10 items-center justify-between gap-4 border-b border-zinc-700/80 py-2">
              <span className="text-sm text-zinc-400">Annual run rate</span>
              <span className="text-sm font-medium tabular-nums text-zinc-100">{usd(d.growth.annualRunRate, masked)}</span>
            </div>
            <div className="flex min-h-10 items-center justify-between gap-4 py-2">
              <span className="text-sm text-zinc-400">Monthly avg</span>
              <span className="text-sm font-medium tabular-nums text-zinc-100">{usd(d.growth.monthlyAvg, masked)}</span>
            </div>
          </div>
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-widest text-orange-200/95">Upcoming</div>
          <div className="mt-3 grid gap-0">
            <div className="flex min-h-10 items-center justify-between gap-4 border-b border-zinc-700/80 py-2">
              <span className="text-sm text-zinc-400">Next 30 days</span>
              <span className="text-sm font-medium tabular-nums text-zinc-100">{usd(d.upcoming.next30dAmount, masked)}</span>
            </div>
            <div className="flex min-h-10 items-center justify-between gap-4 border-b border-zinc-700/80 py-2">
              <span className="text-sm text-zinc-400">Payments coming</span>
              <span className="text-sm font-medium tabular-nums text-zinc-100">{d.upcoming.paymentsComing}</span>
            </div>
            <div className="flex min-h-10 items-center justify-between gap-4 border-b border-zinc-700/80 py-2">
              <span className="text-sm text-zinc-400">Next payer</span>
              <span className="text-sm font-medium tabular-nums text-zinc-100">{d.upcoming.nextPayer ?? "—"}</span>
            </div>
            <div className="flex min-h-10 items-center justify-between gap-4 border-b border-zinc-700/80 py-2">
              <span className="text-sm text-zinc-400">Next date</span>
              <span className="text-sm font-medium tabular-nums text-zinc-100">{d.upcoming.nextDate ?? "—"}</span>
            </div>
            <div className="flex min-h-10 items-center justify-between gap-4 py-2">
              <span className="text-sm text-zinc-400">Milestones hit</span>
              <span className="text-sm font-medium tabular-nums text-zinc-100">{d.milestonesHit}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-zinc-600/80 bg-zinc-950 p-5 shadow-lg sm:p-6">
          <div className="text-sm font-semibold uppercase tracking-wide text-cyan-200/95">Cumulative dividends</div>
          <p className="mt-2 text-sm leading-relaxed text-zinc-400">
            From simulated monthly payouts (Yahoo dividend history × your share counts) after you build history.
          </p>
          <div className="mt-5 h-56 w-full min-w-0">
            {cumData.length === 0 ? (
              <div className="flex h-full items-center justify-center px-4 text-center text-sm leading-relaxed text-zinc-400">
                No dividend cashflows matched these tickers yet.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%" minHeight={200}>
                <LineChart data={cumData} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
                  <XAxis dataKey="month" tick={{ fill: "#a1a1aa", fontSize: 11 }} />
                  <YAxis tick={{ fill: "#a1a1aa", fontSize: 11 }} tickFormatter={(v: number) => usd(v, masked)} width={60} />
                  <Tooltip
                    formatter={(v) => usd(typeof v === "number" ? v : Number(v), masked)}
                    labelClassName="text-zinc-900"
                  />
                  <Line
                    type="monotone"
                    dataKey="cumulative"
                    name="Cumulative"
                    stroke={EARTH_TONE_PIE_COLORS[0]}
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-zinc-600/80 bg-zinc-950 p-5 shadow-lg sm:p-6">
          <div className="text-sm font-semibold uppercase tracking-wide text-fuchsia-200/95">Sector value</div>
          <p className="mt-2 text-sm leading-relaxed text-zinc-400">Weights from local taxonomy + live marks.</p>
          <div className="mt-5 h-56 w-full min-w-0">
            {d.sectorBreakdown.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-zinc-400">No sector data.</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%" minHeight={200}>
                <PieChart>
                  <Pie
                    data={d.sectorBreakdown}
                    dataKey="value"
                    nameKey="sector"
                    cx="50%"
                    cy="50%"
                    outerRadius={78}
                    stroke="#18181b"
                  >
                    {d.sectorBreakdown.map((_, i) => (
                      <Cell key={i} fill={distinctColorForIndex(i)} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v) => usd(typeof v === "number" ? v : Number(v), masked)} />
                  <Legend wrapperStyle={{ fontSize: 12, lineHeight: "1.35rem" }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
          <div className="mt-3 text-center text-sm text-zinc-400">
            Diversification score:{" "}
            <span className="font-semibold text-zinc-100">
              {d.diversificationScore != null ? `${d.diversificationScore}/100` : "—"}
            </span>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-zinc-600/80 bg-zinc-950 p-5 shadow-lg sm:p-6">
        <div className="text-sm font-semibold uppercase tracking-wide text-emerald-200/95">Ticker treemap — position size</div>
        <p className="mt-2 text-sm leading-relaxed text-zinc-400">Area ∝ market value (latest quote × shares).</p>
        <div className="mt-5 h-72 w-full min-w-0">
          {treemapData.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-zinc-400">No market values to chart.</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%" minHeight={260}>
              <Treemap
                data={treemapData}
                dataKey="size"
                nameKey="name"
                aspectRatio={4 / 3}
                stroke="#09090b"
                isAnimationActive={false}
              />
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}

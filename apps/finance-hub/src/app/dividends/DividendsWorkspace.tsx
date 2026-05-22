"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { DividendBookDashboard } from "@/app/dividends/DividendBookDashboard";
import { usePrivacy } from "@/app/components/PrivacyProvider";
import { SymbolLink } from "@/app/components/SymbolLink";
import { formatUsd2 } from "@/lib/format";
import {
  formatDisplayDate,
  formatDisplayDateRange,
  formatModeledChartMonthEndLabel,
  formatPeriodEndingLabel,
} from "@/lib/formatDate";
import { symbolPageHref } from "@/lib/symbolPage";
import type { PortfolioDashboard } from "@/lib/dividends/portfolioDashboard";
import type { DividendBookBanner } from "@/lib/dividends/schwabDividendBook";
import { trackingModeTheme } from "@/lib/dividends/trackingModeTheme";

const DM_CHART_PORT = "#a855f7";
const DM_CHART_SPY = "#ffffff";
const DM_CHART_QQQ = "#f97316";

const liveTheme = trackingModeTheme("live");

type TableRow = {
  symbol: string;
  displayName: string | null;
  accountsLabel: string;
  shares: number | null;
  last: number | null;
  divYield: number | null;
  annualDivEst: number | null;
  marketValue: number | null;
  nextExDate: string | null;
  sector: string | null;
  industry: string | null;
  avgUnitCost: number | null;
  category: string;
  cost: number | null;
};

type TableFooter = {
  totalShares: number;
  totalMv: number;
  totalAnnualDiv: number;
  portfolioYieldPct: number | null;
};

type TimelinePoint = {
  month_end: string;
  portfolio_rebased_pct: number | null;
  total_market_value: number | null;
  total_dividends: number;
  spy_rebased_pct: number | null;
  qqq_rebased_pct: number | null;
  status: string;
};

type SortCol = "symbol" | "name" | "accounts" | "category" | "cost" | "annual$" | "mv" | "yield" | "shares";

function positionAnnualDiv(r: { annualDivEst: number | null; shares: number | null }): number | null {
  if (r.annualDivEst == null || r.shares == null || !Number.isFinite(r.annualDivEst) || !Number.isFinite(r.shares)) return null;
  if (r.shares <= 0) return null;
  const v = r.annualDivEst * r.shares;
  return Number.isFinite(v) ? v : null;
}

function rowYieldPct(r: {
  divYield: number | null;
  annualDivEst: number | null;
  last: number | null;
  shares: number | null;
  marketValue: number | null;
}): number | null {
  const px =
    r.last ??
    (r.shares != null && r.shares > 0 && r.marketValue != null && r.marketValue > 0 ? r.marketValue / r.shares : null);
  if (r.divYield != null && Number.isFinite(r.divYield) && r.divYield >= 0) return r.divYield * 100;
  if (px != null && px > 0 && r.annualDivEst != null && Number.isFinite(r.annualDivEst) && r.annualDivEst >= 0) {
    return (r.annualDivEst / px) * 100;
  }
  return null;
}

function SortTh({
  col,
  label,
  sortCol,
  sortAsc,
  onToggle,
  align = "right",
}: {
  col: SortCol;
  label: string;
  sortCol: SortCol;
  sortAsc: boolean;
  onToggle: (c: SortCol) => void;
  align?: "left" | "right";
}) {
  const active = sortCol === col;
  const arrow = active ? (sortAsc ? " ▲" : " ▼") : "";
  return (
    <button
      type="button"
      onClick={() => onToggle(col)}
      className={
        "inline-flex w-full items-center gap-1 hover:underline underline-offset-4 " +
        (align === "right" ? "justify-end" : "justify-start")
      }
    >
      <span>{label}</span>
      <span className="text-xs opacity-70">{arrow}</span>
    </button>
  );
}

function pctFmt(v: number | null) {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(2)}%`;
}

function yearsBetweenIso(isoStart: string, isoEnd: string): number {
  const start = new Date(`${isoStart.slice(0, 10)}T12:00:00Z`).getTime();
  const end = new Date(`${isoEnd.slice(0, 10)}T12:00:00Z`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.max((end - start) / (365.25 * 86_400_000), 1 / 52);
}

function annualizedReturnPct(totalReturnPct: number | null | undefined, yearsElapsed: number): number | null {
  if (totalReturnPct == null || !Number.isFinite(totalReturnPct) || yearsElapsed <= 0) return null;
  const factor = 1 + totalReturnPct / 100;
  if (!Number.isFinite(factor) || factor <= 0) return null;
  return (Math.pow(factor, 1 / yearsElapsed) - 1) * 100;
}

function usdMasked(v: number | null, masked: boolean) {
  if (v == null || !Number.isFinite(v)) return "—";
  return formatUsd2(v, { mask: masked });
}

export function DividendsWorkspace() {
  const router = useRouter();
  const privacy = usePrivacy();
  const goToTerminalSymbol = useCallback(
    (s: string) => {
      const href = symbolPageHref(s);
      if (href) void router.push(href);
    },
    [router],
  );

  const [banner, setBanner] = useState<DividendBookBanner | null>(null);
  const [hasSchwabSnapshots, setHasSchwabSnapshots] = useState(false);
  const [tableRows, setTableRows] = useState<TableRow[]>([]);
  const [tableFooter, setTableFooter] = useState<TableFooter>({
    totalShares: 0,
    totalMv: 0,
    totalAnnualDiv: 0,
    portfolioYieldPct: null,
  });
  const [dashboard, setDashboard] = useState<PortfolioDashboard | null>(null);
  const [workspaceTab, setWorkspaceTab] = useState<"overview" | "holdings">("overview");
  const [totalDividendsReceived, setTotalDividendsReceived] = useState<number | null>(null);

  const [timeline, setTimeline] = useState<TimelinePoint[]>([]);
  const [timelineFootnote, setTimelineFootnote] = useState<string | null>(null);
  const [timelineSpanSummary, setTimelineSpanSummary] = useState<string | null>(null);
  const [liveStartedAt, setLiveStartedAt] = useState<string | null>(null);

  const [showSpy, setShowSpy] = useState(false);
  const [showQqq, setShowQqq] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [sortCol, setSortCol] = useState<SortCol>("mv");
  const [sortAsc, setSortAsc] = useState(false);

  const loadBook = useCallback(async () => {
    const resp = await fetch("/api/dividends/book", { cache: "no-store" });
    const json = (await resp.json()) as {
      ok: boolean;
      banner?: DividendBookBanner;
      hasSchwabSnapshots?: boolean;
      liveStartedAt?: string | null;
      error?: string;
    };
    if (!json.ok) throw new Error(json.error ?? "Failed to load book");
    setBanner(json.banner ?? null);
    setHasSchwabSnapshots(json.hasSchwabSnapshots ?? false);
    setLiveStartedAt(json.liveStartedAt ?? null);
  }, []);

  const loadTable = useCallback(async () => {
    const resp = await fetch("/api/dividends/holdings", { cache: "no-store" });
    const json = (await resp.json()) as {
      ok: boolean;
      rows?: TableRow[];
      footer?: TableFooter;
      error?: string;
    };
    if (!json.ok) throw new Error(json.error ?? "Failed to load holdings");
    setTableRows(json.rows ?? []);
    if (json.footer) setTableFooter(json.footer);
  }, []);

  const loadDashboard = useCallback(async () => {
    const resp = await fetch("/api/dividends/dashboard", { cache: "no-store" });
    const json = (await resp.json()) as { ok: boolean; dashboard?: PortfolioDashboard; error?: string };
    if (!json.ok) throw new Error(json.error ?? "Failed to load dashboard");
    setDashboard(json.dashboard ?? null);
  }, []);

  const loadTimeline = useCallback(async () => {
    const qs = new URLSearchParams({
      includeSpy: showSpy ? "1" : "0",
      includeQqq: showQqq ? "1" : "0",
    });
    const resp = await fetch(`/api/dividends/timeline?${qs}`, { cache: "no-store" });
    const json = (await resp.json()) as {
      ok: boolean;
      points?: TimelinePoint[];
      footnote?: string;
      monthsReturned?: number;
      firstMonthEnd?: string | null;
      lastMonthEnd?: string | null;
      totalDividendsReceived?: number;
      liveStartedAt?: string | null;
      error?: string;
    };
    if (!json.ok) throw new Error(json.error ?? "Failed to load timeline");
    setTimeline(json.points ?? []);
    setLiveStartedAt(json.liveStartedAt ?? null);
    setTotalDividendsReceived(
      typeof json.totalDividendsReceived === "number" && Number.isFinite(json.totalDividendsReceived)
        ? json.totalDividendsReceived
        : null,
    );
    setTimelineFootnote(json.footnote ?? null);
    const n = json.monthsReturned;
    if (typeof n === "number") {
      if (n === 0) {
        setTimelineSpanSummary(
          "No live tracking snapshots yet. Sync Schwab holdings, then use Refresh live data.",
        );
      } else {
        const a = json.firstMonthEnd ?? "";
        const b = json.lastMonthEnd ?? "";
        const start = formatDisplayDate(json.liveStartedAt, { fallback: "live start" });
        setTimelineSpanSummary(
          `Live tracking: ${n} weekly snapshot${n === 1 ? "" : "s"} (${formatDisplayDateRange(a, b)}) since ${start}.`,
        );
      }
    } else {
      setTimelineSpanSummary(null);
    }
  }, [showSpy, showQqq]);

  const loadAll = useCallback(async () => {
    await Promise.all([loadBook(), loadTable(), loadDashboard(), loadTimeline()]);
  }, [loadBook, loadTable, loadDashboard, loadTimeline]);

  useEffect(() => {
    void (async () => {
      setError(null);
      try {
        await loadAll();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [loadAll]);

  useEffect(() => {
    void (async () => {
      setError(null);
      try {
        await loadTimeline();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [showSpy, showQqq, loadTimeline]);

  const toggleSort = (c: SortCol) => {
    if (sortCol === c) setSortAsc(!sortAsc);
    else {
      setSortCol(c);
      setSortAsc(c === "symbol" || c === "accounts");
    }
  };

  const sortedRows = useMemo(() => {
    const rows = [...tableRows];
    rows.sort((a, b) => {
      const dir = sortAsc ? 1 : -1;
      if (sortCol === "symbol") return a.symbol.localeCompare(b.symbol) * dir;
      if (sortCol === "accounts") return a.accountsLabel.localeCompare(b.accountsLabel) * dir;
      if (sortCol === "name") {
        const an = (a.displayName ?? "").toLowerCase();
        const bn = (b.displayName ?? "").toLowerCase();
        const c = an.localeCompare(bn);
        return c !== 0 ? c * dir : a.symbol.localeCompare(b.symbol) * dir;
      }
      if (sortCol === "category") {
        const c = a.category.localeCompare(b.category);
        return c !== 0 ? c * dir : a.symbol.localeCompare(b.symbol) * dir;
      }
      if (sortCol === "cost") return ((a.cost ?? -1) - (b.cost ?? -1)) * dir;
      if (sortCol === "mv") return ((a.marketValue ?? -1) - (b.marketValue ?? -1)) * dir;
      if (sortCol === "yield") return ((rowYieldPct(a) ?? -1) - (rowYieldPct(b) ?? -1)) * dir;
      if (sortCol === "annual$") return ((positionAnnualDiv(a) ?? -1) - (positionAnnualDiv(b) ?? -1)) * dir;
      return ((a.shares ?? -1) - (b.shares ?? -1)) * dir;
    });
    return rows;
  }, [tableRows, sortCol, sortAsc]);

  const chartData = useMemo(() => {
    const raw = timeline.map((p) => ({
      monthEnd: p.month_end.slice(0, 10),
      port:
        p.portfolio_rebased_pct != null && Number.isFinite(p.portfolio_rebased_pct) ? p.portfolio_rebased_pct : 0,
      navUsd: p.total_market_value != null && Number.isFinite(p.total_market_value) ? p.total_market_value : null,
      spy: p.spy_rebased_pct != null && Number.isFinite(p.spy_rebased_pct) ? p.spy_rebased_pct : undefined,
      qqq: p.qqq_rebased_pct != null && Number.isFinite(p.qqq_rebased_pct) ? p.qqq_rebased_pct : undefined,
    }));
    if (raw.length === 0) return [];
    const port0 = raw[0]!.port;
    const spy0 = raw[0]!.spy ?? 0;
    const qqq0 = raw[0]!.qqq ?? 0;
    return raw.map((p) => ({
      monthEnd: p.monthEnd,
      port: p.port - port0,
      navUsd: p.navUsd,
      spy: p.spy != null ? p.spy - spy0 : undefined,
      qqq: p.qqq != null ? p.qqq - qqq0 : undefined,
    }));
  }, [timeline]);

  const chartEmpty = chartData.length === 0;

  const chartAnnualized = useMemo(() => {
    if (chartData.length < 2) return null;
    const first = chartData[0]!;
    const last = chartData[chartData.length - 1]!;
    const yearsElapsed = yearsBetweenIso(first.monthEnd, last.monthEnd);
    if (yearsElapsed <= 0) return null;
    return {
      yearsElapsed,
      portfolio: annualizedReturnPct(last.port, yearsElapsed),
      spy: showSpy ? annualizedReturnPct(last.spy, yearsElapsed) : null,
      qqq: showQqq ? annualizedReturnPct(last.qqq, yearsElapsed) : null,
    };
  }, [chartData, showSpy, showQqq]);

  async function onRefreshLive() {
    setBusy("refresh");
    setError(null);
    try {
      const resp = await fetch("/api/dividends/refresh-live", { method: "POST" });
      const json = (await resp.json()) as { ok?: boolean; error?: string };
      if (!json.ok) throw new Error(json.error ?? "Refresh failed");
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex w-full max-w-[108rem] flex-1 flex-col gap-8 py-10 pl-5 pr-6 sm:pl-6 sm:pr-8">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Dividends</h1>
          <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-zinc-600 dark:text-zinc-400">
            Dividend-centric view across all Schwab accounts: holdings from your latest Schwab sync, aggregated by
            symbol. Use <span className="font-medium">Refresh live data</span> to fetch fundamentals, yields, and
            categories from Schwab/Yahoo. For backtest and modeling, use the standalone Simulated Dividend Portfolio app.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy === "refresh"}
            onClick={() => void onRefreshLive()}
            className="h-9 rounded-lg border border-sky-400 bg-sky-50 px-3 text-sm font-semibold text-sky-950 shadow-sm hover:bg-sky-100 disabled:opacity-50 dark:border-sky-600 dark:bg-sky-950/40 dark:text-sky-100 dark:hover:bg-sky-950/60"
          >
            {busy === "refresh" ? "Refreshing…" : "Refresh live data"}
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950/30 dark:text-red-200">{error}</div>
      ) : null}

      {banner ? (
        <section className={`rounded-2xl border p-5 sm:p-6 ${liveTheme.panelClass}`}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Combined Schwab book</h2>
              {banner.snapshotAsOf ? (
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  Positions as of {formatDisplayDate(banner.snapshotAsOf)}
                </p>
              ) : null}
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {banner.dividendSymbolCount} dividend symbol{banner.dividendSymbolCount === 1 ? "" : "s"} ·{" "}
              {banner.totalEquitySymbolCount} equity/fund total
            </p>
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-zinc-200 bg-white/60 p-4 dark:border-white/10 dark:bg-white/5">
              <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                Dividend share of book
              </div>
              <div className="mt-2 text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                {pctFmt(banner.dividendShareOfBookPct)}
              </div>
              <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                {usdMasked(banner.dividendMarketValue, privacy.masked)} dividend MV of{" "}
                {usdMasked(banner.totalEquityMarketValue, privacy.masked)} equity book
              </p>
            </div>
            <div className="rounded-xl border border-zinc-200 bg-white/60 p-4 dark:border-white/10 dark:bg-white/5">
              <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                Combined book yield
              </div>
              <div className="mt-2 text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                {pctFmt(banner.combinedBookYieldPct)}
              </div>
              <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">All equity/fund positions (MV-weighted)</p>
            </div>
            <div className="rounded-xl border border-zinc-200 bg-white/60 p-4 dark:border-white/10 dark:bg-white/5">
              <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                Dividend-slice yield
              </div>
              <div className="mt-2 text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                {pctFmt(banner.dividendSliceYieldPct)}
              </div>
              <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">Yield on dividend-paying portion only</p>
            </div>
          </div>
        </section>
      ) : null}

      {!hasSchwabSnapshots ? (
        <div className="rounded-xl border border-dashed border-zinc-300 p-6 text-sm text-zinc-600 dark:border-white/20 dark:text-zinc-400">
          <p className="font-medium text-zinc-800 dark:text-zinc-200">No Schwab holdings snapshots yet</p>
          <p className="mt-2">
            Run a Schwab sync from{" "}
            <Link href="/connections" className="font-semibold underline underline-offset-2">
              Connections
            </Link>{" "}
            to populate positions, then return here.
          </p>
        </div>
      ) : (
        <section className="rounded-2xl border border-zinc-300 bg-white p-6 shadow-sm sm:p-7 dark:border-white/20 dark:bg-zinc-950">
          <div className="flex flex-wrap gap-2 border-b border-zinc-200 pb-3 dark:border-white/10">
            <button
              type="button"
              onClick={() => setWorkspaceTab("overview")}
              className={
                "rounded-full px-4 py-2 text-sm font-semibold " +
                (workspaceTab === "overview"
                  ? "bg-zinc-900 text-white dark:bg-white dark:text-black"
                  : "border border-zinc-300 text-zinc-700 dark:border-white/20 dark:text-zinc-300")
              }
            >
              Overview
            </button>
            <button
              type="button"
              onClick={() => setWorkspaceTab("holdings")}
              className={
                "rounded-full px-4 py-2 text-sm font-semibold " +
                (workspaceTab === "holdings"
                  ? "bg-zinc-900 text-white dark:bg-white dark:text-black"
                  : "border border-zinc-300 text-zinc-700 dark:border-white/20 dark:text-zinc-300")
              }
            >
              Holdings
            </button>
          </div>

          {workspaceTab === "overview" ? (
            <div className="mt-5">
              <DividendBookDashboard dashboard={dashboard} masked={privacy.masked} />
            </div>
          ) : sortedRows.length === 0 ? (
            <div className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
              No dividend-paying Schwab positions found in the latest sync.
            </div>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[1100px] border-collapse text-[15px]">
                <thead>
                  <tr className="border-b border-zinc-200 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:border-white/10 dark:text-zinc-400">
                    <th className="py-3 pr-3">
                      <SortTh col="symbol" label="Symbol" sortCol={sortCol} sortAsc={sortAsc} onToggle={toggleSort} align="left" />
                    </th>
                    <th className="py-2.5 pr-3">
                      <SortTh col="name" label="Name" sortCol={sortCol} sortAsc={sortAsc} onToggle={toggleSort} align="left" />
                    </th>
                    <th className="py-2.5 pr-3">
                      <SortTh col="accounts" label="Account(s)" sortCol={sortCol} sortAsc={sortAsc} onToggle={toggleSort} align="left" />
                    </th>
                    <th className="py-2.5 pr-3">
                      <SortTh col="category" label="Category" sortCol={sortCol} sortAsc={sortAsc} onToggle={toggleSort} align="left" />
                    </th>
                    <th className="py-2.5 pr-3 text-right">
                      <SortTh col="yield" label="Yield %" sortCol={sortCol} sortAsc={sortAsc} onToggle={toggleSort} />
                    </th>
                    <th className="py-2.5 pr-3 text-right">
                      <SortTh col="annual$" label="Est. annual div" sortCol={sortCol} sortAsc={sortAsc} onToggle={toggleSort} />
                    </th>
                    <th className="py-2.5 pr-3 text-right">
                      <SortTh col="shares" label="Shares" sortCol={sortCol} sortAsc={sortAsc} onToggle={toggleSort} />
                    </th>
                    <th className="py-2.5 pr-3 text-right">Avg price</th>
                    <th className="py-2.5 pr-3 text-right">
                      <SortTh col="cost" label="Cost" sortCol={sortCol} sortAsc={sortAsc} onToggle={toggleSort} />
                    </th>
                    <th className="py-2.5 pr-3 text-right">Last</th>
                    <th className="py-2.5 pr-3 text-right">
                      <SortTh col="mv" label="Market value" sortCol={sortCol} sortAsc={sortAsc} onToggle={toggleSort} />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((r) => (
                    <tr
                      key={r.symbol}
                      role="button"
                      tabIndex={0}
                      onClick={() => goToTerminalSymbol(r.symbol)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          goToTerminalSymbol(r.symbol);
                        }
                      }}
                      className="cursor-pointer border-b border-zinc-100 hover:bg-zinc-50 dark:border-white/5 dark:hover:bg-white/5"
                    >
                      <td className="py-2.5 pr-3 font-semibold text-zinc-900 dark:text-zinc-100" onClick={(e) => e.stopPropagation()}>
                        <SymbolLink symbol={r.symbol}>{r.symbol}</SymbolLink>
                      </td>
                      <td className="max-w-[16rem] truncate py-2.5 pr-3 text-sm text-zinc-600 dark:text-zinc-400" title={r.displayName ?? undefined}>
                        {r.displayName ?? "—"}
                      </td>
                      <td className="max-w-[14rem] truncate py-2.5 pr-3 text-xs text-zinc-600 dark:text-zinc-400" title={r.accountsLabel}>
                        {r.accountsLabel || "—"}
                      </td>
                      <td className="max-w-[10rem] truncate py-2.5 pr-3 text-xs text-zinc-600 dark:text-zinc-400">{r.category || "—"}</td>
                      <td className="py-2.5 pr-3 text-right tabular-nums">{pctFmt(rowYieldPct(r))}</td>
                      <td className="py-2.5 pr-3 text-right tabular-nums">{usdMasked(positionAnnualDiv(r), privacy.masked)}</td>
                      <td className="py-2.5 pr-3 text-right tabular-nums">
                        {r.shares != null && Number.isFinite(r.shares)
                          ? r.shares.toLocaleString(undefined, { maximumFractionDigits: 4 })
                          : "—"}
                      </td>
                      <td className="py-2.5 pr-3 text-right tabular-nums text-zinc-600 dark:text-zinc-400">
                        {usdMasked(r.avgUnitCost, privacy.masked)}
                      </td>
                      <td className="py-2.5 pr-3 text-right tabular-nums font-medium text-teal-700 dark:text-teal-300">
                        {usdMasked(r.cost, privacy.masked)}
                      </td>
                      <td className="py-2.5 pr-3 text-right tabular-nums text-zinc-600 dark:text-zinc-400">
                        {usdMasked(r.last, privacy.masked)}
                      </td>
                      <td className="py-2.5 pr-3 text-right tabular-nums">{usdMasked(r.marketValue, privacy.masked)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-zinc-300 bg-zinc-50 text-xs font-semibold text-zinc-800 dark:border-white/20 dark:bg-white/5 dark:text-zinc-100">
                    <td className="py-2.5 pr-3">Totals</td>
                    <td className="py-2.5 pr-3">—</td>
                    <td className="py-2.5 pr-3">—</td>
                    <td className="py-2.5 pr-3">—</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">{pctFmt(tableFooter.portfolioYieldPct)}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">{usdMasked(tableFooter.totalAnnualDiv, privacy.masked)}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">
                      {Number.isFinite(tableFooter.totalShares)
                        ? tableFooter.totalShares.toLocaleString(undefined, { maximumFractionDigits: 4 })
                        : "—"}
                    </td>
                    <td className="py-2.5 pr-3">—</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-teal-700 dark:text-teal-300">
                      {usdMasked(sortedRows.reduce((s, row) => s + (row.cost ?? 0), 0), privacy.masked)}
                    </td>
                    <td className="py-2.5 pr-3">—</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">{usdMasked(tableFooter.totalMv, privacy.masked)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </section>
      )}

      <section className="rounded-2xl border border-zinc-300 bg-white p-6 shadow-sm sm:p-7 dark:border-white/20 dark:bg-zinc-950">
        <div>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Live forward chart</h2>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Weekly NAV % for the aggregated dividend book across all Schwab accounts.
          </p>
        </div>

        <div className="mt-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300">
          Live tracking · single portfolio NAV % line rebased to first snapshot
          {liveStartedAt ? (
            <span className="mt-1 block text-xs opacity-90">
              Live since {formatDisplayDate(liveStartedAt)}
            </span>
          ) : null}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-4 text-sm">
          <label className="flex items-center gap-2 text-zinc-800 dark:text-white">
            <input type="checkbox" checked={showSpy} onChange={(e) => setShowSpy(e.target.checked)} />
            SPY
          </label>
          <label className="flex items-center gap-2" style={{ color: DM_CHART_QQQ }}>
            <input type="checkbox" checked={showQqq} onChange={(e) => setShowQqq(e.target.checked)} />
            QQQ
          </label>
          <span className="text-xs text-zinc-500 dark:text-zinc-400">Weekly snapshots since live start</span>
        </div>

        {timelineFootnote ? <div className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">{timelineFootnote}</div> : null}
        {timelineSpanSummary ? <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{timelineSpanSummary}</div> : null}

        <div className="mt-4 flex min-h-[24rem] w-full min-w-0 flex-col">
          {chartEmpty ? (
            <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-600 dark:border-white/20 dark:text-zinc-400">
              <p className="font-medium text-zinc-800 dark:text-zinc-200">No live tracking snapshots yet.</p>
              <p className="mt-2 max-w-md">
                Sync Schwab holdings, then use <span className="font-semibold">Refresh live data</span> to capture the first
                weekly NAV snapshot.
              </p>
            </div>
          ) : (
            <div className="h-96 w-full min-h-[24rem] flex-1">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={320} debounce={50}>
                <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#a1a1aa" strokeOpacity={0.35} />
                  <XAxis
                    dataKey="monthEnd"
                    tickFormatter={(v: string) => formatModeledChartMonthEndLabel(v, 1, true)}
                    tick={{ fontSize: 10, fill: "#71717a" }}
                    stroke="#a1a1aa"
                    strokeOpacity={0.7}
                    interval="preserveStartEnd"
                    minTickGap={4}
                  />
                  <YAxis
                    width={48}
                    tickFormatter={(v) => `${Number(v).toFixed(0)}%`}
                    stroke="#a1a1aa"
                    strokeOpacity={0.7}
                  />
                  <Tooltip
                    labelFormatter={(v) => (typeof v === "string" ? formatPeriodEndingLabel(v, true) : String(v))}
                    content={({ active: tipActive, payload, label }) => {
                      if (!tipActive || !payload?.length) return null;
                      const row = payload[0]?.payload as (typeof chartData)[number] | undefined;
                      if (!row) return null;
                      const pct = (n: number | null | undefined) =>
                        n != null && Number.isFinite(n) ? `${n.toFixed(2)}%` : "—";
                      const usd = (n: number | null | undefined) => usdMasked(n ?? null, privacy.masked);
                      return (
                        <div className="max-w-xs rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs shadow-md dark:border-white/20 dark:bg-zinc-900">
                          <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                            {typeof label === "string" ? formatPeriodEndingLabel(label, true) : String(label)}
                          </div>
                          <ul className="mt-1.5 space-y-1 tabular-nums">
                            <li className="flex justify-between gap-4" style={{ color: DM_CHART_PORT }}>
                              <span>Portfolio NAV</span>
                              <span>
                                {pct(row.port)} · {usd(row.navUsd)}
                              </span>
                            </li>
                          </ul>
                        </div>
                      );
                    }}
                  />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="port"
                    name="Portfolio %"
                    stroke={DM_CHART_PORT}
                    dot={false}
                    strokeWidth={2}
                    connectNulls
                  />
                  {showSpy ? (
                    <Line
                      type="monotone"
                      dataKey="spy"
                      name="SPY %"
                      stroke={DM_CHART_SPY}
                      style={{ filter: "drop-shadow(0 0 1.5px rgba(0,0,0,0.75))" }}
                      dot={false}
                      strokeWidth={1.5}
                      connectNulls
                    />
                  ) : null}
                  {showQqq ? (
                    <Line
                      type="monotone"
                      dataKey="qqq"
                      name="QQQ %"
                      stroke={DM_CHART_QQQ}
                      dot={false}
                      strokeWidth={1.5}
                      connectNulls
                    />
                  ) : null}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="mt-4 flex flex-col gap-3 text-sm text-zinc-700 dark:text-zinc-300 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
          <p>
            <span className="font-medium">Total dividends received (live):</span>{" "}
            {totalDividendsReceived != null ? usdMasked(totalDividendsReceived, privacy.masked) : "—"}
          </p>
          {chartAnnualized ? (
            <div className="flex flex-col gap-1.5 sm:items-end">
              <p>
                <span className="font-medium">Annualized return:</span>{" "}
                <span className="tabular-nums">{pctFmt(chartAnnualized.portfolio)}</span>
              </p>
              {showSpy || showQqq ? (
                <p className="text-xs text-zinc-700 dark:text-zinc-300">
                  {showSpy ? (
                    <>
                      <span className="font-medium text-zinc-800 dark:text-white">SPY</span>{" "}
                      <span className="tabular-nums text-zinc-800 dark:text-white">{pctFmt(chartAnnualized.spy)}</span>
                    </>
                  ) : null}
                  {showSpy && showQqq ? <span className="mx-1.5">·</span> : null}
                  {showQqq ? (
                    <>
                      <span className="font-medium" style={{ color: DM_CHART_QQQ }}>
                        QQQ
                      </span>{" "}
                      <span style={{ color: DM_CHART_QQQ }}>{pctFmt(chartAnnualized.qqq)}</span>
                    </>
                  ) : null}
                  <span> (over {chartAnnualized.yearsElapsed.toFixed(2)} yr)</span>
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

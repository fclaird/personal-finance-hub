"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Area,
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

import { DividendModelsDashboard } from "@/app/dividend-models/DividendModelsDashboard";
import { usePrivacy } from "@/app/components/PrivacyProvider";
import { SymbolLink } from "@/app/components/SymbolLink";
import { distinctColorForIndex } from "@/lib/charts/pieEarthTones";
import { formatUsd2 } from "@/lib/format";
import {
  formatDisplayDate,
  formatDisplayDateRange,
  formatModeledChartMonthEndLabel,
  formatPeriodEndingLabel,
} from "@/lib/formatDate";
import { symbolPageHref } from "@/lib/symbolPage";
import {
  DEFAULT_DIVIDEND_MODEL_PORTFOLIO_ID,
  DIVIDEND_MODEL_PRESET_PORTFOLIOS,
} from "@/lib/dividendModels/constants";
import type { PortfolioDashboard } from "@/lib/dividendModels/dashboardMetrics";
import { trackingModeTheme } from "@/lib/dividendModels/trackingModeTheme";
import type { TrackingMode } from "@/lib/dividendModels/types";

const PRESET_PORTFOLIO_ORDER = Object.fromEntries(
  DIVIDEND_MODEL_PRESET_PORTFOLIOS.map((preset, index) => [preset.id, index]),
) as Record<string, number>;
const PRESET_PORTFOLIO_BADGE = Object.fromEntries(
  DIVIDEND_MODEL_PRESET_PORTFOLIOS.filter((preset) => preset.multiplier > 1).map((preset) => [
    preset.id,
    `${preset.multiplier}×`,
  ]),
) as Record<string, string>;

function sortPortfoliosForSidebar<T extends { id: string; createdAt: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    const ao = PRESET_PORTFOLIO_ORDER[a.id] ?? 999;
    const bo = PRESET_PORTFOLIO_ORDER[b.id] ?? 999;
    if (ao !== bo) return ao - bo;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

const DM_CHART_PORT = distinctColorForIndex(10);
const DM_CHART_SPY = "#ffffff";
const DM_CHART_QQQ = "#f97316";
/** Cash dividends overlay (withdraw mode) — green to make collected cash obvious. */
const DM_CHART_CASH_FILL = "#22c55e";
/** Reinvested-share lift overlay (reinvest mode) — teal so it's distinct from the cash green. */
const DM_CHART_DRIP_FILL = "#14b8a6";

type PortfolioRow = {
  id: string;
  name: string;
  createdAt: string;
  liveStartedAt: string | null;
  trackingMode: TrackingMode;
  holdingCount: number;
  sliceAccountId: string | null;
};

type TableRow = {
  holdingId: string;
  symbol: string;
  displayName: string | null;
  shares: number | null;
  sortOrder: number;
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
  backtestStartPrice5y: number | null;
};

type TableFooter = {
  totalShares: number;
  totalMv: number;
  totalAnnualDiv: number;
  portfolioYieldPct: number | null;
};

type ModeledPoint = {
  month_end: string;
  price_only_rebased_pct: number | null;
  portfolio_rebased_pct: number | null;
  total_market_value: number | null;
  total_dividends: number;
  spy_rebased_pct: number | null;
  qqq_rebased_pct: number | null;
  status: string;
};

type SortCol = "symbol" | "name" | "category" | "cost" | "annual$" | "mv" | "yield" | "shares";

type TimelineYears = 1 | 3 | 5;
type SimulationMode = "reinvest" | "withdraw";
/** Stacked return decomposition:
 *  - Base (purple): price-only % (`price_only_rebased_pct`, frozen shares).
 *  - Top (green/teal): dividend layer — cash % (withdraw) or DRIP lift % (reinvest).
 *  - Line (purple): total portfolio % = base + top.
 */
type ChartView = "withdraw" | "reinvest";

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

/** Calendar years between two ISO dates (minimum ~1 week for live snapshots). */
function yearsBetweenIso(isoStart: string, isoEnd: string): number {
  const start = new Date(`${isoStart.slice(0, 10)}T12:00:00Z`).getTime();
  const end = new Date(`${isoEnd.slice(0, 10)}T12:00:00Z`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.max((end - start) / (365.25 * 86_400_000), 1 / 52);
}

/** CAGR from total % return over `yearsElapsed` (e.g. 50% over 5y → ~8.45%/yr). */
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

export default function DividendModelsPage() {
  const router = useRouter();
  const privacy = usePrivacy();
  const goToTerminalSymbol = useCallback(
    (s: string) => {
      const href = symbolPageHref(s);
      if (href) void router.push(href);
    },
    [router],
  );
  const [portfolios, setPortfolios] = useState<PortfolioRow[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
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

  const [modeled, setModeled] = useState<ModeledPoint[]>([]);
  const [modeledFootnote, setModeledFootnote] = useState<string | null>(null);
  const [modeledSpanSummary, setModeledSpanSummary] = useState<string | null>(null);

  const [years, setYears] = useState<TimelineYears>(5);
  const [chartView, setChartView] = useState<ChartView>("withdraw");
  const simulationMode: SimulationMode = chartView === "reinvest" ? "reinvest" : "withdraw";
  const [showSpy, setShowSpy] = useState(false);
  const [showQqq, setShowQqq] = useState(false);

  const [newPortfolioName, setNewPortfolioName] = useState("");
  const [rename, setRename] = useState("");
  const [newSym, setNewSym] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);

  const [sortCol, setSortCol] = useState<SortCol>("mv");
  const [sortAsc, setSortAsc] = useState(false);

  const active = useMemo(() => portfolios.find((p) => p.id === activeId) ?? null, [portfolios, activeId]);
  const isAlphaPortfolio = activeId === DEFAULT_DIVIDEND_MODEL_PORTFOLIO_ID;
  const trackingMode: TrackingMode = active?.trackingMode ?? "backtest";
  const modeTheme = useMemo(() => trackingModeTheme(trackingMode), [trackingMode]);

  const loadPortfolios = useCallback(async () => {
    const resp = await fetch("/api/dividend-models/portfolios", { cache: "no-store" });
    const json = (await resp.json()) as { ok: boolean; portfolios?: PortfolioRow[]; error?: string };
    if (!json.ok) throw new Error(json.error ?? "Failed to load portfolios");
    const list = sortPortfoliosForSidebar(json.portfolios ?? []);
    setPortfolios(list);
    setActiveId((cur) => {
      if (cur && list.some((p) => p.id === cur)) return cur;
      return list[0]?.id ?? null;
    });
  }, []);

  const loadTable = useCallback(async (pid: string, opts?: { refetchFundamentals?: boolean }) => {
    const qs = opts?.refetchFundamentals ? "?refetchFundamentals=1" : "";
    const resp = await fetch(`/api/dividend-models/portfolios/${encodeURIComponent(pid)}/table${qs}`, {
      cache: "no-store",
    });
    const json = (await resp.json()) as {
      ok: boolean;
      rows?: TableRow[];
      footer?: TableFooter;
      error?: string;
    };
    if (!json.ok) throw new Error(json.error ?? "Failed to load table");
    setTableRows(json.rows ?? []);
    if (json.footer) setTableFooter(json.footer);
  }, []);

  const loadDashboard = useCallback(async (pid: string) => {
    const resp = await fetch(`/api/dividend-models/portfolios/${encodeURIComponent(pid)}/dashboard`, { cache: "no-store" });
    const json = (await resp.json()) as { ok: boolean; dashboard?: PortfolioDashboard; error?: string };
    if (!json.ok) throw new Error(json.error ?? "Failed to load dashboard");
    setDashboard(json.dashboard ?? null);
  }, []);

  const loadModeled = useCallback(
    async (pid: string) => {
      const qs = new URLSearchParams({
        years: String(years),
        mode: simulationMode,
        trackingMode,
        includeSpy: showSpy ? "1" : "0",
        includeQqq: showQqq ? "1" : "0",
      });
      const resp = await fetch(`/api/dividend-models/portfolios/${encodeURIComponent(pid)}/timeline?${qs}`, {
        cache: "no-store",
      });
      const json = (await resp.json()) as {
        ok: boolean;
        points?: ModeledPoint[];
        footnote?: string;
        years?: number;
        monthsReturned?: number;
        firstMonthEnd?: string | null;
        lastMonthEnd?: string | null;
        totalDividendsReceived?: number;
        trackingMode?: string;
        liveStartedAt?: string | null;
        error?: string;
      };
      if (!json.ok) throw new Error(json.error ?? "Failed to load modeled timeline");
      setModeled(json.points ?? []);
      setTotalDividendsReceived(
        typeof json.totalDividendsReceived === "number" && Number.isFinite(json.totalDividendsReceived)
          ? json.totalDividendsReceived
          : null,
      );
      setModeledFootnote(json.footnote ?? null);
      const y = json.years ?? years;
      const n = json.monthsReturned;
      if (typeof n === "number") {
        if (n === 0) {
          setModeledSpanSummary(
            trackingMode === "live"
              ? "No live tracking snapshots yet. Switch to Live tracking and run Refresh fundamentals."
              : `No month-end points in the last ${y} years for this portfolio yet.`,
          );
        } else if (trackingMode === "live") {
          const a = json.firstMonthEnd ?? "";
          const b = json.lastMonthEnd ?? "";
          const liveStart = formatDisplayDate(json.liveStartedAt, { fallback: "live start" });
          setModeledSpanSummary(
            `Live tracking: ${n} weekly snapshot${n === 1 ? "" : "s"} (${formatDisplayDateRange(a, b)}) since ${liveStart}.`,
          );
        } else {
          const a = json.firstMonthEnd ?? "";
          const b = json.lastMonthEnd ?? "";
          setModeledSpanSummary(
            `Showing ${n} simulated month-end${n === 1 ? "" : "s"} (${formatDisplayDateRange(a, b)}) for the ${y}-year backtest window (market prices at window start, not purchase price).`,
          );
        }
      } else {
        setModeledSpanSummary(null);
      }
    },
    [years, simulationMode, showSpy, showQqq, trackingMode],
  );

  useEffect(() => {
    void (async () => {
      setError(null);
      try {
        await loadPortfolios();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [loadPortfolios]);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      setWorkspaceTab("overview");
      setDashboard(null);
      setModeledSpanSummary(null);
      setModeledFootnote(null);
      setTotalDividendsReceived(null);
    });
    return () => cancelAnimationFrame(id);
  }, [activeId]);

  useEffect(() => {
    if (!activeId) return;
    void (async () => {
      setError(null);
      try {
        await loadTable(activeId);
        await loadDashboard(activeId);
        await loadPortfolios();
        await loadModeled(activeId);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [activeId, years, simulationMode, showSpy, showQqq, trackingMode, loadTable, loadDashboard, loadModeled, loadPortfolios]);

  async function setPortfolioTrackingMode(mode: TrackingMode) {
    if (!activeId) return;
    setBusy("tracking");
    setError(null);
    try {
      const resp = await fetch(`/api/dividend-models/portfolios/${encodeURIComponent(activeId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trackingMode: mode }),
      });
      const json = (await resp.json()) as { ok?: boolean; error?: string };
      if (!json.ok) throw new Error(json.error ?? "Failed to update tracking mode");
      await loadPortfolios();
      await loadModeled(activeId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const toggleSort = (c: SortCol) => {
    if (sortCol === c) setSortAsc(!sortAsc);
    else {
      setSortCol(c);
      setSortAsc(c === "symbol");
    }
  };

  const sortedRows = useMemo(() => {
    const rows = [...tableRows];
    rows.sort((a, b) => {
      const dir = sortAsc ? 1 : -1;
      if (sortCol === "symbol") return a.symbol.localeCompare(b.symbol) * dir;
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
      if (sortCol === "cost") {
        const av = a.cost ?? -1;
        const bv = b.cost ?? -1;
        return (av - bv) * dir;
      }
      if (sortCol === "mv") {
        const av = a.marketValue ?? -1;
        const bv = b.marketValue ?? -1;
        return (av - bv) * dir;
      }
      if (sortCol === "yield") {
        const av = rowYieldPct(a) ?? -1;
        const bv = rowYieldPct(b) ?? -1;
        return (av - bv) * dir;
      }
      if (sortCol === "annual$") {
        const av = positionAnnualDiv(a) ?? -1;
        const bv = positionAnnualDiv(b) ?? -1;
        return (av - bv) * dir;
      }
      const av = a.shares ?? -1;
      const bv = b.shares ?? -1;
      return (av - bv) * dir;
    });
    return rows;
  }, [tableRows, sortCol, sortAsc]);

  const modeledChart = useMemo(() => {
    const anchorNav = modeled[0]?.total_market_value ?? null;
    let cumDivUsd = 0;
    const raw = modeled.map((p) => {
      cumDivUsd += Math.max(0, Number(p.total_dividends) || 0);
      const port = p.portfolio_rebased_pct != null && Number.isFinite(p.portfolio_rebased_pct) ? p.portfolio_rebased_pct : 0;
      const priceFromApi =
        p.price_only_rebased_pct != null && Number.isFinite(p.price_only_rebased_pct) ? p.price_only_rebased_pct : null;
      const sharesPct = priceFromApi ?? port;
      const navUsd =
        p.total_market_value != null && Number.isFinite(p.total_market_value) ? p.total_market_value : null;
      return {
        monthEnd: p.month_end.slice(0, 10),
        port,
        sharesPct,
        navUsd,
        cumDivUsd,
        spy: p.spy_rebased_pct != null && Number.isFinite(p.spy_rebased_pct) ? p.spy_rebased_pct : undefined,
        qqq: p.qqq_rebased_pct != null && Number.isFinite(p.qqq_rebased_pct) ? p.qqq_rebased_pct : undefined,
      };
    });
    if (raw.length === 0) return [];
    const equityAnchor =
      anchorNav != null && Number.isFinite(anchorNav) ? anchorNav - (raw[0]!.cumDivUsd ?? 0) : null;
    const port0 = raw[0]!.port;
    const shares0 = raw[0]!.sharesPct;
    const spy0 = raw[0]!.spy ?? 0;
    const qqq0 = raw[0]!.qqq ?? 0;
    return raw.map((p) => {
      const port = p.port - port0;
      const sharesPct = p.sharesPct - shares0;
      const topPct = Math.max(0, port - sharesPct);
      const priceOnlyUsd =
        equityAnchor != null && equityAnchor > 0 ? equityAnchor * (1 + sharesPct / 100) : null;
      const navUsd = p.navUsd;
      const divStackUsd =
        navUsd != null && priceOnlyUsd != null ? navUsd - priceOnlyUsd : null;
      return {
        monthEnd: p.monthEnd,
        port,
        sharesPct,
        topPct,
        navUsd,
        cumDivUsd: p.cumDivUsd,
        priceOnlyUsd,
        divStackUsd,
        spy: p.spy != null ? p.spy - spy0 : undefined,
        qqq: p.qqq != null ? p.qqq - qqq0 : undefined,
      };
    });
  }, [modeled]);

  const modeledChartEmpty = modeledChart.length === 0;
  const liveWeeklyChart = trackingMode === "live";

  const chartAnnualizedReturns = useMemo(() => {
    if (modeledChart.length < 2) return null;
    const first = modeledChart[0]!;
    const last = modeledChart[modeledChart.length - 1]!;
    const yearsElapsed = liveWeeklyChart ? yearsBetweenIso(first.monthEnd, last.monthEnd) : years;
    if (yearsElapsed <= 0) return null;
    return {
      yearsElapsed,
      withDividends: annualizedReturnPct(last.port, yearsElapsed),
      withoutDividends: annualizedReturnPct(last.sharesPct, yearsElapsed),
      spy: showSpy ? annualizedReturnPct(last.spy, yearsElapsed) : null,
      qqq: showQqq ? annualizedReturnPct(last.qqq, yearsElapsed) : null,
    };
  }, [modeledChart, years, liveWeeklyChart, showSpy, showQqq]);

  async function onRefreshData() {
    if (!activeId) return;
    setBusy("refresh");
    setError(null);
    try {
      const resp = await fetch(`/api/dividend-models/portfolios/${encodeURIComponent(activeId)}/refresh`, {
        method: "POST",
      });
      const json = (await resp.json()) as { ok?: boolean; error?: string };
      if (!json.ok) throw new Error(json.error ?? "Refresh failed");
      await Promise.all([loadTable(activeId), loadDashboard(activeId), loadPortfolios(), loadModeled(activeId)]);
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
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Sim Dividend Portfolio</h1>
          <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-zinc-600 dark:text-zinc-400">
            Manual portfolios with share counts. Build history to materialize five years of symbol-level monthly prices, dividends, and trailing yield, then chart 1y / 3y / 5y paths with dividend reinvestment vs withdrawal.
          </p>
        </div>
        <Link
          href="/dividends"
          className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 shadow-sm hover:bg-zinc-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5"
        >
          Dividends rollup
        </Link>
      </div>

      {error ? (
        <div className="rounded-xl bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950/30 dark:text-red-200">{error}</div>
      ) : null}
      {refreshMessage ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-900/40 dark:bg-amber-950/25 dark:text-amber-100">
          {refreshMessage}
        </div>
      ) : null}

      <section className="rounded-2xl border border-zinc-300 bg-white p-6 shadow-sm sm:p-7 dark:border-white/20 dark:bg-zinc-950">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="grid gap-2">
            <div className="text-[15px] font-semibold text-zinc-800 dark:text-zinc-200">Portfolios</div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={newPortfolioName}
                onChange={(e) => setNewPortfolioName(e.target.value)}
                placeholder="New portfolio name"
                className="h-9 w-56 rounded-lg border border-zinc-300 bg-white px-2 text-sm text-zinc-900 shadow-sm placeholder:text-zinc-400 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-500"
              />
              <button
                type="button"
                onClick={() => {
                  const name = newPortfolioName.trim();
                  if (!name) return;
                  void (async () => {
                    setError(null);
                    try {
                      const resp = await fetch("/api/dividend-models/portfolios", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ name }),
                      });
                      const json = (await resp.json()) as { ok?: boolean; id?: string; error?: string };
                      if (!json.ok) throw new Error(json.error ?? "Create failed");
                      setNewPortfolioName("");
                      await loadPortfolios();
                      if (json.id) setActiveId(json.id);
                    } catch (e) {
                      setError(e instanceof Error ? e.message : String(e));
                    }
                  })();
                }}
                className="h-9 rounded-lg bg-zinc-950 px-3 text-sm font-semibold text-white hover:bg-zinc-900 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
              >
                Create
              </button>
            </div>
          </div>
          <button
            type="button"
            disabled={!activeId || busy === "refresh"}
            onClick={() => void onRefreshData()}
            className="h-9 rounded-lg border border-zinc-300 bg-white px-3 text-sm font-semibold text-zinc-900 shadow-sm hover:bg-zinc-50 disabled:opacity-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5"
          >
            {busy === "refresh" ? "Building…" : "Build history"}
          </button>
        </div>

        <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,18rem)_1fr] lg:gap-6">
          <div className="rounded-xl border border-zinc-300 p-4 dark:border-white/20">
            <div className="text-[15px] font-semibold text-zinc-800 dark:text-zinc-200">Lists</div>
            <div className="mt-3 grid max-h-80 gap-2 overflow-y-auto pr-0.5">
              {portfolios.length === 0 ? (
                <div className="text-sm text-zinc-600 dark:text-zinc-400">Loading…</div>
              ) : null}
              {portfolios.map((p) => {
                const sel = p.id === activeId;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setActiveId(p.id)}
                    className={
                      "flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-left text-[15px] leading-snug " +
                      (sel
                        ? "border-zinc-950 bg-zinc-950 text-white dark:border-white dark:bg-white dark:text-black"
                        : "border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5")
                    }
                  >
                    <span className="flex items-center gap-2 font-semibold">
                      <span
                        className={`inline-block h-2 w-2 shrink-0 rounded-full ${
                          trackingModeTheme(p.trackingMode).dotClass
                        }`}
                        aria-hidden
                      />
                      {p.name}
                      {PRESET_PORTFOLIO_BADGE[p.id] ? (
                        <span
                          className={
                            "rounded px-1 py-0.5 text-[10px] font-bold uppercase tracking-wide " +
                            (sel
                              ? "bg-white/20 text-white dark:bg-black/10 dark:text-black"
                              : "bg-zinc-200 text-zinc-700 dark:bg-white/10 dark:text-zinc-300")
                          }
                        >
                          {PRESET_PORTFOLIO_BADGE[p.id]}
                        </span>
                      ) : null}
                    </span>
                    <span
                      className={
                        "tabular-nums text-xs " + (sel ? "text-white/90 dark:text-black/70" : "text-zinc-600 dark:text-zinc-400")
                      }
                    >
                      {p.holdingCount}
                    </span>
                  </button>
                );
              })}
            </div>
            {active ? (
              <div className="mt-5 grid gap-3 border-t border-zinc-200 pt-4 dark:border-white/10">
                <div className="text-xs font-semibold uppercase tracking-widest text-zinc-500 dark:text-zinc-400">Rename</div>
                <div className="flex flex-wrap gap-2">
                  <input
                    value={rename}
                    onChange={(e) => setRename(e.target.value)}
                    placeholder={active.name}
                    className="h-10 min-w-[8rem] flex-1 rounded-lg border border-zinc-300 bg-white px-3 text-sm dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100"
                  />
                  <button
                    type="button"
                    className="h-10 rounded-lg border border-zinc-300 px-3 text-sm font-semibold dark:border-white/20 dark:text-zinc-100"
                    onClick={() => {
                      const name = rename.trim();
                      if (!name || !activeId) return;
                      void (async () => {
                        setError(null);
                        try {
                          const resp = await fetch(`/api/dividend-models/portfolios/${encodeURIComponent(activeId)}`, {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ name }),
                          });
                          const json = (await resp.json()) as { ok?: boolean; error?: string };
                          if (!json.ok) throw new Error(json.error ?? "Rename failed");
                          setRename("");
                          await loadPortfolios();
                        } catch (e) {
                          setError(e instanceof Error ? e.message : String(e));
                        }
                      })();
                    }}
                  >
                    Save
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {isAlphaPortfolio ? (
                    <button
                      type="button"
                      disabled={busy === "sync-shares"}
                      className="h-10 rounded-lg border border-amber-400 bg-amber-50 px-3 text-sm font-semibold text-amber-950 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-600 dark:bg-amber-950/40 dark:text-amber-100 dark:hover:bg-amber-950/60"
                      onClick={() => {
                        void (async () => {
                          setError(null);
                          setRefreshMessage(null);
                          setBusy("sync-shares");
                          try {
                            const resp = await fetch("/api/dividend-models/portfolios/sync-scaled-shares", {
                              method: "POST",
                            });
                            const json = (await resp.json()) as {
                              ok?: boolean;
                              error?: string;
                              targets?: Array<{ name: string; multiplier: number; holdingsSynced: number }>;
                            };
                            if (!json.ok) throw new Error(json.error ?? "Sync failed");
                            const summary =
                              json.targets
                                ?.map((t) => `${t.name} (${t.multiplier}×, ${t.holdingsSynced} symbols)`)
                                .join("; ") ?? "";
                            setRefreshMessage(
                              summary
                                ? `Synced alpha share counts to scaled portfolios: ${summary}. Rebuild history on bravo and charlie if charts are stale.`
                                : "Synced alpha share counts to bravo and charlie.",
                            );
                            await loadPortfolios();
                          } catch (e) {
                            setError(e instanceof Error ? e.message : String(e));
                          } finally {
                            setBusy(null);
                          }
                        })();
                      }}
                    >
                      {busy === "sync-shares" ? "Syncing…" : "Sync shares to bravo & charlie"}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="h-10 rounded-lg border border-zinc-300 px-3 text-sm font-semibold dark:border-white/20 dark:text-zinc-100"
                    onClick={() => {
                      if (!activeId) return;
                      void (async () => {
                        setError(null);
                        try {
                          const resp = await fetch(
                            `/api/dividend-models/portfolios/${encodeURIComponent(activeId)}/duplicate`,
                            { method: "POST" },
                          );
                          const json = (await resp.json()) as { ok?: boolean; id?: string; error?: string };
                          if (!json.ok) throw new Error(json.error ?? "Duplicate failed");
                          await loadPortfolios();
                          if (json.id) setActiveId(json.id);
                        } catch (e) {
                          setError(e instanceof Error ? e.message : String(e));
                        }
                      })();
                    }}
                  >
                    Duplicate
                  </button>
                  <button
                    type="button"
                    className="h-10 rounded-lg border border-red-300 px-3 text-sm font-semibold text-red-800 dark:border-red-900/50 dark:text-red-200"
                    onClick={() => {
                      if (!activeId) return;
                      if (!confirm(`Delete portfolio “${active.name}”? This cannot be undone.`)) return;
                      void (async () => {
                        setError(null);
                        try {
                          const resp = await fetch(`/api/dividend-models/portfolios/${encodeURIComponent(activeId)}`, {
                            method: "DELETE",
                          });
                          const json = (await resp.json()) as { ok?: boolean; error?: string };
                          if (!json.ok) throw new Error(json.error ?? "Delete failed");
                          setActiveId(null);
                          await loadPortfolios();
                        } catch (e) {
                          setError(e instanceof Error ? e.message : String(e));
                        }
                      })();
                    }}
                  >
                    Delete
                  </button>
                </div>
                <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                  Set share counts on every holding, then use <span className="font-medium">Build history</span> to materialize
                  monthly simulation data.
                </p>
              </div>
            ) : null}
          </div>

          <div className="rounded-xl border border-zinc-300 p-4 dark:border-white/20">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="text-[15px] font-semibold text-zinc-800 dark:text-zinc-200">
                {active ? `Holdings: ${active.name}` : "Select a portfolio"}
              </div>
              {activeId ? (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    value={newSym}
                    onChange={(e) => setNewSym(e.target.value)}
                    placeholder="Symbol"
                    className="h-9 w-40 rounded-lg border border-zinc-300 bg-white px-2 text-sm dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const symbol = newSym.trim().toUpperCase();
                      if (!activeId || !symbol) return;
                      void (async () => {
                        setError(null);
                        try {
                          const resp = await fetch(`/api/dividend-models/portfolios/${encodeURIComponent(activeId)}/holdings`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ symbol }),
                          });
                          const json = (await resp.json()) as { ok?: boolean; error?: string };
                          if (!json.ok) throw new Error(json.error ?? "Add failed");
                          setNewSym("");
                          await Promise.all([loadTable(activeId), loadDashboard(activeId), loadPortfolios()]);
                        } catch (e) {
                          setError(e instanceof Error ? e.message : String(e));
                        }
                      })();
                    }}
                    className="h-9 rounded-lg bg-zinc-950 px-3 text-sm font-semibold text-white dark:bg-white dark:text-black"
                  >
                    Add
                  </button>
                  <button
                    type="button"
                    disabled={busy === "fundamentals"}
                    title="Re-fetch fundamentals, instrument names (Yahoo/Schwab), dividends, and chart history for all holdings."
                    onClick={() => {
                      if (!activeId) return;
                      void (async () => {
                        setBusy("fundamentals");
                        setError(null);
                        setRefreshMessage(null);
                        try {
                          const resp = await fetch(
                            `/api/dividend-models/portfolios/${encodeURIComponent(activeId)}/refresh-fundamentals`,
                            { method: "POST" },
                          );
                          const json = (await resp.json()) as {
                            ok?: boolean;
                            partial?: boolean;
                            message?: string;
                            error?: string;
                          };
                          if (!json.ok) throw new Error(json.error ?? "Refresh failed");
                          if (json.message) setRefreshMessage(json.message);
                          await Promise.all([
                            loadTable(activeId),
                            loadDashboard(activeId),
                            loadModeled(activeId),
                          ]);
                        } catch (e) {
                          setError(e instanceof Error ? e.message : String(e));
                        } finally {
                          setBusy(null);
                        }
                      })();
                    }}
                    className="h-9 rounded-lg border border-zinc-300 px-3 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-40 dark:border-white/20 dark:text-zinc-100 dark:hover:bg-white/5"
                  >
                    {busy === "fundamentals" ? "Refreshing…" : "Refresh fundamentals"}
                  </button>
                </div>
              ) : null}
            </div>

            {!activeId ? (
              <div className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">Choose a portfolio.</div>
            ) : (
              <>
                <div className="mt-4 flex flex-wrap gap-2 border-b border-zinc-200 pb-3 dark:border-white/10">
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
                    <DividendModelsDashboard dashboard={dashboard} masked={privacy.masked} />
                  </div>
                 ) : (

                  <>
                    {sortedRows.length === 0 ? (
                      <div className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">No symbols yet.</div>
                    ) : (
                      <div className="mt-3 overflow-x-auto">
                        <table className="w-full min-w-[1100px] border-collapse text-[15px]">
                          <thead>
                            <tr className="border-b border-zinc-200 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:border-white/10 dark:text-zinc-400">
                              <th className="py-3 pr-3">
                                <SortTh
                                  col="symbol"
                                  label="Symbol"
                                  sortCol={sortCol}
                                  sortAsc={sortAsc}
                                  onToggle={toggleSort}
                                  align="left"
                                />
                              </th>
                              <th className="py-2.5 pr-3">
                                <SortTh
                                  col="name"
                                  label="Name"
                                  sortCol={sortCol}
                                  sortAsc={sortAsc}
                                  onToggle={toggleSort}
                                  align="left"
                                />
                              </th>
                              <th className="py-2.5 pr-3">
                                <SortTh
                                  col="category"
                                  label="Category"
                                  sortCol={sortCol}
                                  sortAsc={sortAsc}
                                  onToggle={toggleSort}
                                  align="left"
                                />
                              </th>
                              <th className="py-2.5 pr-3 text-right">
                                <SortTh col="yield" label="Yield %" sortCol={sortCol} sortAsc={sortAsc} onToggle={toggleSort} />
                              </th>
                              <th className="py-2.5 pr-3 text-right">
                                <SortTh
                                  col="annual$"
                                  label="Est. annual div"
                                  sortCol={sortCol}
                                  sortAsc={sortAsc}
                                  onToggle={toggleSort}
                                />
                              </th>
                              <th className="py-2.5 pr-3 text-right">
                                <SortTh col="shares" label="Shares" sortCol={sortCol} sortAsc={sortAsc} onToggle={toggleSort} />
                              </th>
                              <th className="py-2.5 pr-3 text-right">Avg price</th>
                              <th className="py-2.5 pr-3 text-right" title="Market close at 5y backtest window start (not your purchase price)">
                                5y start
                              </th>
                              <th className="py-2.5 pr-3 text-right">
                                <SortTh col="cost" label="Cost" sortCol={sortCol} sortAsc={sortAsc} onToggle={toggleSort} />
                              </th>
                              <th className="py-2.5 pr-3 text-right">Last</th>
                              <th className="py-2.5 pr-3 text-right">
                                <SortTh col="mv" label="Market value" sortCol={sortCol} sortAsc={sortAsc} onToggle={toggleSort} />
                              </th>
                              <th className="py-3 pr-3 text-right"> </th>
                            </tr>
                          </thead>

                          <tbody>
                            {sortedRows.map((r) => (
                              <tr
                                key={r.holdingId}
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
                                <td className="max-w-[10rem] truncate py-2.5 pr-3 text-xs text-zinc-600 dark:text-zinc-400" title={r.category}>
                                  {r.category || "—"}
                                </td>
                                <td className="py-2.5 pr-3 text-right tabular-nums">{pctFmt(rowYieldPct(r))}</td>
                                <td className="py-2.5 pr-3 text-right tabular-nums">{usdMasked(positionAnnualDiv(r), privacy.masked)}</td>
                                <td className="py-2.5 pr-3 text-right" onClick={(e) => e.stopPropagation()}>
                                  <input
                                    className="h-8 w-24 cursor-text rounded border border-zinc-300 bg-white px-1 text-right tabular-nums dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100"
                                    defaultValue={r.shares ?? ""}
                                    key={`${r.holdingId}-${r.shares ?? "null"}`}
                                    onBlur={(e) => {
                                      const raw = e.target.value.trim();
                                      const shares = raw === "" ? null : Number(raw);
                                      if (shares != null && !Number.isFinite(shares)) return;
                                      if (shares === r.shares || (shares == null && r.shares == null)) return;
                                      void (async () => {
                                        try {
                                          await fetch(
                                            `/api/dividend-models/portfolios/${encodeURIComponent(activeId!)}/holdings`,
                                            {
                                              method: "PATCH",
                                              headers: { "Content-Type": "application/json" },
                                              body: JSON.stringify({ symbol: r.symbol, shares }),
                                            },
                                          );
                                          await Promise.all([loadTable(activeId!), loadDashboard(activeId!)]);
                                        } catch {
                                          /* ignore */
                                        }
                                      })();
                                    }}
                                  />
                                </td>
                                <td className="py-2.5 pr-3 text-right" onClick={(e) => e.stopPropagation()}>
                                  <input
                                    className="h-8 w-28 cursor-text rounded border border-zinc-300 bg-white px-1 text-right tabular-nums text-xs dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100"
                                    defaultValue={r.avgUnitCost ?? ""}
                                    key={`${r.holdingId}-avg-${r.avgUnitCost ?? "null"}`}
                                    onBlur={(e) => {
                                      const raw = e.target.value.trim();
                                      const avg = raw === "" ? null : Number(raw);
                                      if (avg != null && !Number.isFinite(avg)) return;
                                      if (avg === r.avgUnitCost || (avg == null && r.avgUnitCost == null)) return;
                                      void (async () => {
                                        try {
                                          await fetch(
                                            `/api/dividend-models/portfolios/${encodeURIComponent(activeId!)}/holdings`,
                                            {
                                              method: "PATCH",
                                              headers: { "Content-Type": "application/json" },
                                              body: JSON.stringify({ symbol: r.symbol, avg_unit_cost: avg }),
                                            },
                                          );
                                          await Promise.all([loadTable(activeId!), loadDashboard(activeId!)]);
                                        } catch {
                                          /* ignore */
                                        }
                                      })();
                                    }}
                                  />
                                </td>
                                <td className="py-2.5 pr-3 text-right tabular-nums text-zinc-600 dark:text-zinc-400">
                                  {usdMasked(r.backtestStartPrice5y, privacy.masked)}
                                </td>
                                <td className="py-2.5 pr-3 text-right tabular-nums font-medium text-teal-700 dark:text-teal-300">
                                  {usdMasked(r.cost, privacy.masked)}
                                </td>
                                <td className="py-2.5 pr-3 text-right tabular-nums text-zinc-600 dark:text-zinc-400">
                                  {usdMasked(r.last, privacy.masked)}
                                </td>
                                <td className="py-2.5 pr-3 text-right tabular-nums">{usdMasked(r.marketValue, privacy.masked)}</td>

                                <td className="py-2 text-right" onClick={(e) => e.stopPropagation()}>
                                  <button
                                    type="button"
                                    className="rounded-md border border-zinc-300 px-2 py-1 text-xs dark:border-white/20"
                                    onClick={() => {
                                      void (async () => {
                                        try {
                                          await fetch(
                                            `/api/dividend-models/portfolios/${encodeURIComponent(activeId!)}/holdings?symbol=${encodeURIComponent(r.symbol)}`,
                                            { method: "DELETE" },
                                          );
                                          await Promise.all([loadTable(activeId!), loadDashboard(activeId!)]);
                                          await loadPortfolios();
                                        } catch {
                                          /* ignore */
                                        }
                                      })();
                                    }}
                                  >
                                    Remove
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr className="border-t-2 border-zinc-300 bg-zinc-50 text-xs font-semibold text-zinc-800 dark:border-white/20 dark:bg-white/5 dark:text-zinc-100">
                              <td className="py-2.5 pr-3">Totals</td>
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
                              <td className="py-2.5 pr-3">—</td>
                              <td className="py-2.5 pr-3 text-right tabular-nums text-teal-700 dark:text-teal-300">
                                {usdMasked(
                                  sortedRows.reduce((s, row) => s + (row.cost ?? 0), 0),
                                  privacy.masked,
                                )}
                              </td>
                              <td className="py-2.5 pr-3">—</td>
                              <td className="py-2.5 pr-3 text-right tabular-nums">{usdMasked(tableFooter.totalMv, privacy.masked)}</td>
                              <td className="py-2" />

                            </tr>
                          </tfoot>
                        </table>
                        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-500">
                          Click a row (outside symbol links, inputs, or Remove) to open the symbol in Terminal. Symbol links go
                          there too. Est. annual div is shares × trailing annual dividend per share (Schwab fundamentals when
                          available, otherwise trailing 12-month cash dividends from Yahoo chart history). Yield % is the same
                          basis vs. last price (Yahoo chart price is used if Schwab quotes are unavailable). Use{" "}
                          <span className="font-semibold">Refresh fundamentals</span> if columns stayed empty after connecting
                          Schwab.
                        </p>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </section>

            <section className={modeTheme.panelClass}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className={modeTheme.headerAccentClass}>
            <h2 className="text-base font-semibold">Chart</h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              {trackingMode === "backtest"
                ? "Backtest uses historical market prices at the window start (orange), not your purchase price."
                : "Live tracking (blue) logs forward NAV from current quotes and dividends since your live start date."}
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Mode</span>
          <button
            type="button"
            aria-pressed={trackingMode === "backtest"}
            disabled={busy === "tracking"}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors duration-200 ${
              trackingMode === "backtest" ? modeTheme.toggleActiveClass : modeTheme.toggleInactiveClass
            }`}
            onClick={() => void setPortfolioTrackingMode("backtest")}
          >
            Backtest
          </button>
          <button
            type="button"
            aria-pressed={trackingMode === "live"}
            disabled={busy === "tracking"}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors duration-200 ${
              trackingMode === "live" ? modeTheme.toggleActiveClass : modeTheme.toggleInactiveClass
            }`}
            onClick={() => void setPortfolioTrackingMode("live")}
          >
            Live tracking
          </button>
        </div>

        <div className={`mt-3 ${modeTheme.bannerClass}`}>
          {(() => {
            const prefix = trackingMode === "backtest" ? `Backtest (${years}-year window)` : "Live tracking";
            const suffix =
              chartView === "reinvest"
                ? "· Dividends Reinvest: purple = price-only return; teal stack = extra % from DRIP; green line = total."
                : "· Dividends: purple = price-only return; green stack = dividend contribution to return; green line = total.";
            return `${prefix} ${suffix}`;
          })()}
          {active?.liveStartedAt && trackingMode === "live" ? (
            <span className="mt-1 block text-xs opacity-90">
              Live since {formatDisplayDate(active.liveStartedAt)}
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
          {trackingMode === "backtest" ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-zinc-500">Range</span>
              {([1, 3, 5] as const).map((y) => (
                <button
                  key={y}
                  type="button"
                  className={`rounded-md px-2 py-1 text-xs font-semibold ${
                    years === y ? modeTheme.yearPillActiveClass : "border border-zinc-300 dark:border-white/20"
                  }`}
                  onClick={() => setYears(y)}
                >
                  {y}y
                </button>
              ))}
            </div>
          ) : (
            <span className="text-xs text-zinc-500 dark:text-zinc-400">Weekly snapshots since live start</span>
          )}
          <div className="flex flex-wrap items-center gap-2 border-l border-zinc-200 pl-4 dark:border-white/10">
            <span className="text-zinc-500">View</span>
            <button
              type="button"
              aria-pressed={chartView === "withdraw"}
              title="Portfolio % overlaid with cash from dividends (as % of starting NAV)."
              className={`rounded-md px-2 py-1 text-xs font-semibold transition-colors duration-200 ${
                chartView === "withdraw" ? modeTheme.dividendPillActiveClass : "border border-zinc-300 dark:border-white/20"
              }`}
              onClick={() => setChartView("withdraw")}
            >
              Dividends
            </button>
            <button
              type="button"
              aria-pressed={chartView === "reinvest"}
              title="Starting shares + extra shares acquired via DRIP (each dividend buys fractional shares at the pay-date close)."
              className={`rounded-md px-2 py-1 text-xs font-semibold transition-colors duration-200 ${
                chartView === "reinvest" ? modeTheme.dividendPillActiveClass : "border border-zinc-300 dark:border-white/20"
              }`}
              onClick={() => setChartView("reinvest")}
            >
              Dividends Reinvest
            </button>
          </div>
        </div>

        {modeledFootnote ? <div className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">{modeledFootnote}</div> : null}
        {modeledSpanSummary ? <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{modeledSpanSummary}</div> : null}

        <div className="mt-4 flex min-h-[24rem] w-full min-w-0 flex-col">
          {modeledChartEmpty ? (
            <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-600 dark:border-white/20 dark:text-zinc-400">
              <p className="font-medium text-zinc-800 dark:text-zinc-200">
                {trackingMode === "live" ? "No live tracking snapshots yet." : "No simulated months to chart yet."}
              </p>
              <p className="mt-2 max-w-md">
                {trackingMode === "live" ? (
                  <>
                    Set shares on every holding, switch to <span className="font-semibold">Live tracking</span>, then run{" "}
                    <span className="font-semibold">Refresh fundamentals</span> to capture the first weekly NAV snapshot.
                  </>
                ) : (
                  <>
                    Set shares on every holding, then use <span className="font-semibold">Build history</span> to materialize
                    monthly simulation points.
                  </>
                )}
              </p>
            </div>
          ) : (
            <div className={`h-96 w-full min-h-[24rem] flex-1 ${modeTheme.chartWrapperClass}`}>
              <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={320} debounce={50}>
                <ComposedChart data={modeledChart} margin={{ top: 8, right: 8, left: 0, bottom: 16 }}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke={modeTheme.gridStroke}
                    strokeOpacity={modeTheme.gridStrokeOpacity}
                  />
                  <XAxis
                    dataKey="monthEnd"
                    tickFormatter={(v: string) => formatModeledChartMonthEndLabel(v, years, liveWeeklyChart)}
                    tick={{ fontSize: 10, fill: "#71717a" }}
                    stroke={modeTheme.axisStroke}
                    strokeOpacity={0.7}
                    interval={liveWeeklyChart ? "preserveStartEnd" : years === 1 ? 0 : years === 3 ? 1 : 2}
                    minTickGap={liveWeeklyChart ? 4 : 8}
                  />
                  <YAxis
                    width={48}
                    tickFormatter={(v) => `${Number(v).toFixed(0)}%`}
                    stroke={modeTheme.axisStroke}
                    strokeOpacity={0.7}
                  />
                  <Tooltip
                    labelFormatter={(v) =>
                      typeof v === "string" ? formatPeriodEndingLabel(v, liveWeeklyChart) : String(v)
                    }
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      const row = payload[0]?.payload as (typeof modeledChart)[number] | undefined;
                      if (!row) return null;
                      const pct = (n: number | null | undefined) =>
                        n != null && Number.isFinite(n) ? `${n.toFixed(2)}%` : "—";
                      const usd = (n: number | null | undefined) => usdMasked(n ?? null, privacy.masked);
                      const divLabel =
                        chartView === "reinvest" ? "Dividends reinvested" : "From dividends";
                      return (
                        <div className="max-w-xs rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs shadow-md dark:border-white/20 dark:bg-zinc-900">
                          <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                            {typeof label === "string"
                              ? formatPeriodEndingLabel(label, liveWeeklyChart)
                              : String(label)}
                          </div>
                          <ul className="mt-1.5 space-y-1 tabular-nums">
                            <li className="flex justify-between gap-4" style={{ color: DM_CHART_PORT }}>
                              <span>Price only</span>
                              <span>
                                {pct(row.sharesPct)} · {usd(row.priceOnlyUsd)}
                              </span>
                            </li>
                            {!liveWeeklyChart ? (
                              <li
                                className="flex justify-between gap-4"
                                style={{ color: chartView === "reinvest" ? DM_CHART_DRIP_FILL : DM_CHART_CASH_FILL }}
                              >
                                <span>{divLabel}</span>
                                <span>
                                  {pct(row.topPct)} · {usd(row.divStackUsd)}
                                </span>
                              </li>
                            ) : null}
                            <li className="flex justify-between gap-4" style={{ color: DM_CHART_PORT }}>
                              <span>Total portfolio</span>
                              <span>
                                {pct(row.port)} · {usd(row.navUsd)}
                              </span>
                            </li>
                            {!liveWeeklyChart && chartView === "withdraw" ? (
                              <li className="flex justify-between gap-4 text-zinc-600 dark:text-zinc-400">
                                <span>Cumulative dividends</span>
                                <span>{usd(row.cumDivUsd)}</span>
                              </li>
                            ) : null}
                          </ul>
                        </div>
                      );
                    }}
                  />
                  <Legend />
                  {liveWeeklyChart ? null : (
                    <>
                      <Area
                        type="monotone"
                        stackId="return"
                        dataKey="topPct"
                        name={chartView === "reinvest" ? "Dividends reinvested %" : "From dividends %"}
                        stroke={chartView === "reinvest" ? DM_CHART_DRIP_FILL : DM_CHART_CASH_FILL}
                        strokeWidth={1.5}
                        fill={chartView === "reinvest" ? DM_CHART_DRIP_FILL : DM_CHART_CASH_FILL}
                        fillOpacity={0.4}
                        isAnimationActive={false}
                        connectNulls
                      />
                      <Area
                        type="monotone"
                        stackId="return"
                        dataKey="sharesPct"
                        name="Price only %"
                        stroke={DM_CHART_PORT}
                        strokeWidth={1.5}
                        fill={DM_CHART_PORT}
                        fillOpacity={0.28}
                        isAnimationActive={false}
                        connectNulls
                      />
                      <Line
                        type="monotone"
                        dataKey="topPct"
                        legendType="none"
                        stroke={chartView === "reinvest" ? DM_CHART_DRIP_FILL : DM_CHART_CASH_FILL}
                        strokeWidth={2}
                        dot={false}
                        isAnimationActive={false}
                        connectNulls
                      />
                      <Line
                        type="monotone"
                        dataKey="port"
                        legendType="none"
                        stroke={DM_CHART_PORT}
                        strokeWidth={2}
                        dot={false}
                        isAnimationActive={false}
                        connectNulls
                      />
                    </>
                  )}
                  {liveWeeklyChart ? (
                    <Line
                      type="monotone"
                      dataKey="port"
                      name={chartView === "reinvest" ? "Portfolio % (Dividends Reinvest)" : "Portfolio % (Dividends)"}
                      stroke={DM_CHART_PORT}
                      dot={false}
                      strokeWidth={2}
                      connectNulls
                    />
                  ) : null}
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
            <span className="font-medium">Total dividends received ({years}-year window):</span>{" "}
            {totalDividendsReceived != null ? usdMasked(totalDividendsReceived, privacy.masked) : "—"}
          </p>
          {chartAnnualizedReturns ? (
            <div className="flex flex-col gap-1.5 sm:items-end">
              <p>
                <span className="font-medium">Annualized return (with dividends):</span>{" "}
                <span className="tabular-nums">{pctFmt(chartAnnualizedReturns.withDividends)}</span>
                <span>
                  {" "}
                  · without dividends {pctFmt(chartAnnualizedReturns.withoutDividends)}
                </span>
              </p>
              {showSpy || showQqq ? (
                <p className="text-xs text-zinc-700 dark:text-zinc-300">
                  {showSpy ? (
                    <>
                      <span className="font-medium text-zinc-800 dark:text-white">SPY</span>{" "}
                      <span className="tabular-nums text-zinc-800 dark:text-white">
                        {pctFmt(chartAnnualizedReturns.spy)}
                      </span>
                    </>
                  ) : null}
                  {showSpy && showQqq ? <span className="mx-1.5">·</span> : null}
                  {showQqq ? (
                    <>
                      <span className="font-medium" style={{ color: DM_CHART_QQQ }}>
                        QQQ
                      </span>{" "}
                      <span style={{ color: DM_CHART_QQQ }}>{pctFmt(chartAnnualizedReturns.qqq)}</span>
                    </>
                  ) : null}
                  <span>
                    {" "}
                    (over{" "}
                    {chartAnnualizedReturns.yearsElapsed < 1
                      ? `${Math.round(chartAnnualizedReturns.yearsElapsed * 52)}w`
                      : `${chartAnnualizedReturns.yearsElapsed.toFixed(1)}y`}
                    )
                  </span>
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>


    </div>
  );
}
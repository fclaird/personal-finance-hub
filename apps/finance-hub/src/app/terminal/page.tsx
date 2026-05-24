"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Line, LineChart, ResponsiveContainer } from "recharts";

import { usePrivacy } from "@/app/components/PrivacyProvider";
import { useMarketAwareInterval } from "@/hooks/useMarketAwareInterval";
import { useSchwabRefreshCoordinator } from "@/hooks/useSchwabRefreshCoordinator";
import { isUsEquityPreOpenFuturesPollWindow, isUsEquityRegularSessionOpen } from "@/lib/market/usEquitySession";
import type { NormalizedQuote as ApiNormalizedQuote } from "@/app/api/quotes/route";
import { HeatmapGrid, type HeatmapItem } from "@/app/components/HeatmapGrid";
import { DraggableTileLayout } from "@/app/components/DraggableTileLayout";
import { type UsMarketGlanceItem } from "@/app/components/terminal/MarketGlanceCard";
import { NewsDigestSection } from "@/app/components/terminal/NewsDigestSection";
import {
  OptionFlowPanel,
  type OptionFlowPayload,
} from "@/app/components/terminal/OptionFlowPanel";
import { PortfolioTreemapSection } from "@/app/components/terminal/PortfolioTreemapSection";
import {
  readTreemapMetric,
  readTreemapScope,
  readTreemapSyntheticBasis,
} from "@/app/components/terminal/terminalTreemapPrefs";
import { UsMarketsPanel } from "@/app/components/terminal/UsMarketsPanel";
import { SymbolLink } from "@/app/components/SymbolLink";
import { formatUsd2 } from "@/lib/format";
import {
  type ExposurePieMetric,
  type ExposureRow,
  type ExposureScope,
  type SyntheticChartBasis,
  exposureMvByUnderlying,
  normalizeExposureRow,
  scopeExposureRows,
  terminalTreemapSizeCaption,
} from "@/lib/analytics/exposureWeighting";
import { heatmapCellStyle } from "@/lib/terminal/dailyPerfColor";
import { posNegClass, priceDirClass } from "@/lib/terminal/colors";
import { computeMovers } from "@/lib/terminal/movers";

type WatchlistRow = { id: string; name: string; createdAt: string; itemCount: number };

type NormalizedQuote = ApiNormalizedQuote;

type MoversPayload = {
  ok: boolean;
  scope?: string;
  basketKey?: string; // legacy
  gainers?: NormalizedQuote[];
  losers?: NormalizedQuote[];
  error?: string;
};

type SortCol = "symbol" | "company" | "last" | "chgPct" | "chg" | "volume" | "volX";
type VolumeInfo = { volume: number | null; avgVolume20: number | null; ratio: number | null; flagged: boolean };

type TerminalCol = "symbol" | "company" | "last" | "chg" | "chgPct" | "volume" | "volX";

const DEFAULT_TERMINAL_COL_ORDER: TerminalCol[] = ["symbol", "company", "last", "chg", "chgPct", "volume", "volX"];

const PCT2 = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function pctToTileStyle(pct: number | null): CSSProperties | undefined {
  if (pct == null || !Number.isFinite(pct)) return heatmapCellStyle(null);
  return heatmapCellStyle(pct / 100);
}

/** Horizontal vivid strip behind mover / volume rows (dark theme). */
function sentimentRowBackground(changeFraction: number | null): CSSProperties {
  if (changeFraction == null || !Number.isFinite(changeFraction)) return {};
  const pctPts = changeFraction * 100;
  const mag = clamp(Math.abs(pctPts), 0, 15) / 15;
  const widthPct = 28 + mag * 72;
  const pos = pctPts >= 0;
  const rgb = pos ? "52,211,153" : "248,113,113";
  return {
    backgroundImage: `linear-gradient(90deg, rgba(${rgb},0.5) 0%, rgba(${rgb},0.22) ${Math.round(widthPct * 0.45)}%, rgba(${rgb},0.08) ${widthPct}%, transparent ${widthPct}%)`,
  };
}

function usd2Masked(v: number, masked: boolean) {
  return formatUsd2(v, { mask: masked });
}

function num(v: number | null) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** `last` is reconciled server-side (`/api/quotes`); fall back to `mark` if absent. */
function quoteDisplaySpot(q: NormalizedQuote): number | null {
  return num(q.last) ?? num(q.mark);
}

function volRatioLabel(ratio: number | null) {
  if (ratio == null || !Number.isFinite(ratio)) return "—";
  return ratio >= 10 ? `${ratio.toFixed(0)}×` : `${ratio.toFixed(1)}×`;
}

function isAbortError(e: unknown): boolean {
  if (e instanceof DOMException && e.name === "AbortError") return true;
  if (e instanceof Error) {
    if (e.name === "AbortError") return true;
    const m = e.message.toLowerCase();
    if (m.includes("abort")) return true;
  }
  return false;
}

async function terminalFetchJson<T>(resp: Response, context: string): Promise<T> {
  const raw = await resp.text();
  if (!raw.trim()) {
    throw new Error(`${context}: empty response (${resp.status})`);
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`${context}: invalid JSON from server (${resp.status})`);
  }
}

/** Header control only — must sit inside a single parent `<th>` (never wrap in another `<th>`). */
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
      <span className="text-[10px] opacity-70">{arrow}</span>
    </button>
  );
}

export default function TerminalPage() {
  const privacy = usePrivacy();
  const [watchlists, setWatchlists] = useState<WatchlistRow[]>([]);
  const [watchlistId, setWatchlistId] = useState<string | null>(null);
  const [symbols, setSymbols] = useState<string[]>([]);
  const [quotes, setQuotes] = useState<NormalizedQuote[]>([]);
  const [movers, setMovers] = useState<MoversPayload | null>(null);
  const [optionFlow, setOptionFlow] = useState<OptionFlowPayload | null>(null);
  const [volumeInfo, setVolumeInfo] = useState<Map<string, VolumeInfo>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState<number>(0);
  const [sortCol, setSortCol] = useState<SortCol>("chgPct");
  const [sortAsc, setSortAsc] = useState(false);
  const [colOrder, setColOrder] = useState<TerminalCol[]>(DEFAULT_TERMINAL_COL_ORDER);
  const [companyBySymbol, setCompanyBySymbol] = useState<Map<string, string>>(new Map());
  const [volumeLeadersMode, setVolumeLeadersMode] = useState<"volume" | "volX">("volume");
  const [optionFlowMode, setOptionFlowMode] = useState<"volume" | "relative">("volume");
  const [heatView, setHeatView] = useState<"portfolio" | "spy" | "qqq">("portfolio");
  const [heatItems, setHeatItems] = useState<HeatmapItem[]>([]);
  const [positionMvBySym, setPositionMvBySym] = useState<Map<string, number>>(() => new Map());
  const [exposureRows, setExposureRows] = useState<ExposureRow[]>([]);
  const [exposureBuckets, setExposureBuckets] = useState<
    Array<{ bucketKey: "brokerage" | "retirement" | "529"; exposure: ExposureRow[] }>
  >([]);
  const [treemapScope, setTreemapScope] = useState<ExposureScope>("net");
  const [treemapMetric, setTreemapMetric] = useState<ExposurePieMetric>("net");
  const [treemapSyntheticBasis, setTreemapSyntheticBasis] = useState<SyntheticChartBasis>("delta");
  const treemapPrefsHydratedRef = useRef(false);
  const [futuresItems, setFuturesItems] = useState<
    Array<{ symbol: string; quote: NormalizedQuote; series: Array<{ date: string; close: number }> }>
  >([]);
  const [usMarkets, setUsMarkets] = useState<{
    session: {
      headline: string;
      detail: string;
      isOpen: boolean;
      sessionYmd?: string;
      sessionLabel?: string;
      showingPriorSession?: boolean;
    };
    items: UsMarketGlanceItem[];
    updatedAt: string | null;
  } | null>(null);
  const [clockTick, setClockTick] = useState(() => Date.now());

  const heatViewPrimed = useRef(false);
  const bootstrapInflightRef = useRef<Promise<void> | null>(null);
  const bootstrapInflightKeyRef = useRef("");
  const lastPrimaryLoadAtRef = useRef(0);
  const symbolsRef = useRef(symbols);

  useEffect(() => {
    symbolsRef.current = symbols;
  }, [symbols]);

  const symbolsKey = useMemo(
    () =>
      symbols
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean)
        .sort()
        .join(","),
    [symbols],
  );

  const marketPollResetKey = useMemo(
    () => `${watchlistId ?? ""}|${heatView}`,
    [watchlistId, heatView],
  );

  const treemapMvBySym = useMemo(() => {
    if (exposureRows.length === 0) return positionMvBySym;
    const scoped = scopeExposureRows(exposureRows, exposureBuckets, treemapScope);
    const weighted = exposureMvByUnderlying(scoped, treemapMetric, treemapSyntheticBasis);
    return weighted.size > 0 ? weighted : positionMvBySym;
  }, [exposureRows, exposureBuckets, treemapScope, treemapMetric, treemapSyntheticBasis, positionMvBySym]);

  const treemapSizeCaption = useMemo(
    () => terminalTreemapSizeCaption(treemapScope, treemapMetric, treemapSyntheticBasis),
    [treemapScope, treemapMetric, treemapSyntheticBasis],
  );

  async function loadWatchlists() {
    const resp = await fetch("/api/watchlists", { cache: "no-store" });
    const json = await terminalFetchJson<{ ok: boolean; watchlists?: WatchlistRow[]; error?: string }>(resp, "watchlists");
    if (!json.ok) throw new Error(json.error ?? "Failed to load watchlists");
    setWatchlists(json.watchlists ?? []);
  }

  async function loadExposureWeighting() {
    try {
      const pageResp = await fetch("/api/allocation/page-data?synthetic=1&lite=1", { cache: "no-store" });
      const pageJson = await terminalFetchJson<{
        ok: boolean;
        exposure?: ExposureRow[];
        buckets?: Array<{ bucketKey: "brokerage" | "retirement" | "529"; exposure: ExposureRow[] }>;
      }>(pageResp, "allocation page-data");
      if (pageJson.ok) {
        setExposureRows((pageJson.exposure ?? []).map(normalizeExposureRow));
        setExposureBuckets(
          (pageJson.buckets ?? []).map((b) => ({
            ...b,
            exposure: (b.exposure ?? []).map(normalizeExposureRow),
          })),
        );
      }
    } catch {
      // keep prior exposure data
    }
  }

  async function loadUniverse(nextWatchlistId: string | null) {
    const params = new URLSearchParams();
    params.set("scope", heatView);
    if (heatView === "portfolio" && nextWatchlistId) params.set("watchlistId", nextWatchlistId);
    const q = params.toString() ? `?${params.toString()}` : "";
    const resp = await fetch(`/api/terminal/universe${q}`, { cache: "no-store" });
    const json = await terminalFetchJson<{ ok: boolean; symbols?: string[]; error?: string }>(resp, "terminal universe");
    if (!json.ok) throw new Error(json.error ?? "Failed to load terminal universe");
    setSymbols(json.symbols ?? []);
  }

  async function loadCompanyNames(symList: string[], opts?: { merge?: boolean }) {
    const unique = [...new Set(symList.map((s) => s.trim().toUpperCase()).filter(Boolean))];
    if (unique.length === 0) {
      if (!opts?.merge) setCompanyBySymbol(new Map());
      return;
    }
    const BATCH = 120;
    try {
      const resolved: Record<string, string> = {};
      for (let i = 0; i < unique.length; i += BATCH) {
        const chunk = unique.slice(i, i + BATCH);
        const resp = await fetch("/api/terminal/company-batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbols: chunk }),
        });
        const json = await terminalFetchJson<{ ok?: boolean; names?: Record<string, string | null> }>(
          resp,
          "company names",
        );
        if (!json.ok || !json.names) continue;
        for (const [k, v] of Object.entries(json.names)) {
          const name = (v ?? "").trim();
          if (name) resolved[k.toUpperCase()] = name;
        }
      }
      setCompanyBySymbol((prev) => {
        const m = opts?.merge ? new Map(prev) : new Map<string, string>();
        for (const [k, v] of Object.entries(resolved)) m.set(k, v);
        return m;
      });
    } catch {
      // ignore
    }
  }

  async function loadQuotes(symList: string[]) {
    if (symList.length === 0) {
      setQuotes([]);
      setLastUpdatedAt(new Date().toISOString());
      return;
    }
    const resp = await fetch("/api/quotes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbols: symList }),
    });
    const json = await terminalFetchJson<{ ok: boolean; quotes?: NormalizedQuote[]; error?: string }>(
      resp,
      "quotes",
    );
    if (!json.ok) throw new Error(json.error ?? "Failed to load quotes");
    const rows = json.quotes ?? [];
    setQuotes(rows);
    setLastUpdatedAt(new Date().toISOString());
    const fromQuotes = rows
      .map((q) => [q.symbol.toUpperCase(), q.companyName?.trim()] as const)
      .filter(([, n]) => !!n) as [string, string][];
    if (fromQuotes.length > 0) {
      setCompanyBySymbol((prev) => {
        const m = new Map(prev);
        for (const [sym, name] of fromQuotes) m.set(sym, name);
        return m;
      });
    }
  }

  async function loadVolumeAnomalies(symList: string[]) {
    if (symList.length === 0) {
      setVolumeInfo(new Map());
      return;
    }
    const resp = await fetch("/api/terminal/volume-anomalies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbols: symList }),
    });
    const json = await terminalFetchJson<{
      ok: boolean;
      anomalies?: Record<string, VolumeInfo>;
      error?: string;
    }>(resp, "volume anomalies");
    if (!json.ok) throw new Error(json.error ?? "Failed to load volume anomalies");
    const m = new Map<string, VolumeInfo>();
    for (const [k, v] of Object.entries(json.anomalies ?? {})) m.set(k.toUpperCase(), v);
    setVolumeInfo(m);
  }

  async function loadOptionFlow(nextWatchlistId: string | null) {
    try {
      const qs = new URLSearchParams();
      if (nextWatchlistId) qs.set("watchlistId", nextWatchlistId);
      const resp = await fetch(`/api/terminal/option-flow?${qs.toString()}`, { cache: "no-store" });
      const json = await terminalFetchJson<OptionFlowPayload>(resp, "option flow");
      setOptionFlow(json);
    } catch (e) {
      setOptionFlow({
        ok: true,
        source: "unavailable",
        hint: e instanceof Error ? e.message : String(e),
        items: [],
      });
    }
  }

  async function refreshAll(nextWatchlistId: string | null) {
    setError(null);
    try {
      await Promise.all([loadWatchlists().catch(() => null), loadUniverse(nextWatchlistId)]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function deferTerminalSecondaryLoads(nextWatchlistId: string | null, symList: string[]) {
    window.setTimeout(() => void loadOptionFlow(nextWatchlistId).catch(() => null), 1500);
    window.setTimeout(() => void loadVolumeAnomalies(symList).catch(() => null), 2500);
  }

  function applyBootstrapPayload(
    json: { quotes?: NormalizedQuote[]; heatItems?: HeatmapItem[] },
    symList: string[],
  ) {
    setError(null);
    const rows = json.quotes ?? [];
    const items = json.heatItems ?? [];
    setQuotes(rows);
    setLastUpdatedAt(new Date().toISOString());
    setHeatItems(items);

    const portfolioSet = new Set(symList.map((s) => s.toUpperCase()));
    const portfolioQuotes = rows.filter((q) => portfolioSet.has(q.symbol.toUpperCase()));
    const computed = computeMovers("portfolio", portfolioQuotes, 50);
    setMovers({ ok: true, scope: "myUniverse", gainers: computed.gainers, losers: computed.losers });

    setCompanyBySymbol((prev) => {
      const m = new Map(prev);
      for (const q of rows) {
        const n = q.companyName?.trim();
        if (n) m.set(q.symbol.toUpperCase(), n);
      }
      for (const it of items) {
        const n = it.companyName?.trim();
        if (n) m.set(it.symbol.toUpperCase(), n);
      }
      return m;
    });
  }

  function bootstrapRequestKey(symList: string[], nextWatchlistId: string | null): string {
    const syms = symList
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean)
      .sort()
      .join(",");
    return `${heatView}|${nextWatchlistId ?? ""}|${syms}`;
  }

  async function runTerminalPrimaryLoad(symList: string[], nextWatchlistId: string | null) {
    const key = bootstrapRequestKey(symList, nextWatchlistId);
    if (bootstrapInflightRef.current && bootstrapInflightKeyRef.current === key) {
      return bootstrapInflightRef.current;
    }
    bootstrapInflightKeyRef.current = key;
    const promise = (async () => {
      const resp = await fetch("/api/terminal/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          view: heatView,
          watchlistId: nextWatchlistId,
          indexSymbols: ["SPY", "QQQ"],
        }),
        cache: "no-store",
      });
      const json = await terminalFetchJson<{
        ok: boolean;
        quotes?: NormalizedQuote[];
        heatItems?: HeatmapItem[];
        error?: string;
      }>(resp, "bootstrap");
      if (!json.ok) throw new Error(json.error ?? "Failed to load terminal market data");
      applyBootstrapPayload(json, symList);
      lastPrimaryLoadAtRef.current = Date.now();
      deferTerminalSecondaryLoads(nextWatchlistId, symList);
    })().finally(() => {
      if (bootstrapInflightKeyRef.current === key) {
        bootstrapInflightRef.current = null;
      }
    });
    bootstrapInflightRef.current = promise;
    return promise;
  }

  async function loadFutures() {
    try {
      const resp = await fetch("/api/terminal/futures", { cache: "no-store" });
      const json = await terminalFetchJson<{
        ok: boolean;
        items?: Array<{ symbol: string; quote: NormalizedQuote; series: Array<{ date: string; close: number }> }>;
      }>(resp, "futures");
      if (json.ok) setFuturesItems(json.items ?? []);
    } catch {
      // ignore
    }
  }

  async function loadUsMarkets() {
    try {
      const resp = await fetch("/api/terminal/us-markets", { cache: "no-store" });
      const json = await terminalFetchJson<{
        ok: boolean;
        session?: {
          headline: string;
          detail: string;
          isOpen: boolean;
          sessionYmd?: string;
          sessionLabel?: string;
          showingPriorSession?: boolean;
        };
        items?: UsMarketGlanceItem[];
        updatedAt?: string;
      }>(resp, "us-markets");
      if (!json.ok) return;
      setUsMarkets({
        session: json.session ?? { headline: "U.S. MARKETS", detail: "", isOpen: false },
        items: json.items ?? [],
        updatedAt: json.updatedAt ?? new Date().toISOString(),
      });
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    const t = setTimeout(() => {
      void Promise.all([
        refreshAll(watchlistId),
        loadExposureWeighting(),
        loadUsMarkets(),
      ]);
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const id = setInterval(() => setClockTick(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!heatViewPrimed.current) {
      heatViewPrimed.current = true;
      return;
    }
    void loadUniverse(watchlistId).catch(() => null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heatView, watchlistId]);

  useSchwabRefreshCoordinator({
    onTick: () => {
      const sym = symbolsRef.current;
      if (sym.length === 0) return;
      if (Date.now() - lastPrimaryLoadAtRef.current < 55_000) return;
      void runTerminalPrimaryLoad(sym, watchlistId).catch(() => null);
      void loadExposureWeighting();
    },
    resetKey: marketPollResetKey,
  });

  useEffect(() => {
    setTreemapScope(readTreemapScope());
    setTreemapMetric(readTreemapMetric());
    setTreemapSyntheticBasis(readTreemapSyntheticBasis());
    treemapPrefsHydratedRef.current = true;
  }, []);

  useEffect(() => {
    if (!treemapPrefsHydratedRef.current) return;
    try {
      localStorage.setItem("terminal_treemap_scope_v1", treemapScope);
      localStorage.setItem("terminal_treemap_metric_v1", treemapMetric);
      localStorage.setItem("terminal_treemap_synthetic_basis_v1", treemapSyntheticBasis);
    } catch {
      // ignore
    }
  }, [treemapScope, treemapMetric, treemapSyntheticBasis]);

  useEffect(() => {
    const allowed = new Set<TerminalCol>(["symbol", "company", "last", "chg", "chgPct", "volume", "volX"]);
    const legacyAllowed = new Set<string>(["symbol", "last", "chg", "chgPct", "volume", "volX"]);

    function normalizeOrder(parsed: unknown): TerminalCol[] | null {
      if (!Array.isArray(parsed)) return null;
      let clean = parsed.filter((x) => typeof x === "string" && allowed.has(x as TerminalCol)) as TerminalCol[];
      if (clean.length === 0) {
        clean = parsed.filter((x) => typeof x === "string" && legacyAllowed.has(x as string)) as TerminalCol[];
      }
      if (clean.length === 0) return null;
      if (!clean.includes("company")) {
        const i = clean.indexOf("symbol");
        if (i >= 0) clean.splice(i + 1, 0, "company");
        else clean = ["symbol", "company", ...clean.filter((c) => c !== "symbol")];
      }
      for (const c of DEFAULT_TERMINAL_COL_ORDER) {
        if (!clean.includes(c)) clean.push(c);
      }
      return clean;
    }

    try {
      const rawV2 = localStorage.getItem("terminal_table_column_order_v2");
      if (rawV2) {
        const clean = normalizeOrder(JSON.parse(rawV2) as unknown);
        if (clean?.length) {
          setTimeout(() => setColOrder(clean), 0);
          return;
        }
      }
      const rawV1 = localStorage.getItem("terminal_table_column_order_v1");
      if (rawV1) {
        const clean = normalizeOrder(JSON.parse(rawV1) as unknown);
        if (clean?.length) setTimeout(() => setColOrder(clean), 0);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("terminal_table_column_order_v2", JSON.stringify(colOrder));
    } catch {
      // ignore
    }
  }, [colOrder]);

  useEffect(() => {
    const t = setTimeout(() => setNowMs(Date.now()), 0);
    return () => clearTimeout(t);
  }, [watchlistId, lastUpdatedAt]);

  useEffect(() => {
    if (!symbolsKey) return;
    void runTerminalPrimaryLoad(symbolsRef.current, watchlistId).catch((e) => {
      if (isAbortError(e)) return;
      setError(e instanceof Error ? e.message : String(e));
    });
  }, [symbolsKey, watchlistId]);

  useEffect(() => {
    if (quotes.length === 0) return;
    const t = setTimeout(() => {
      void (async () => {
        try {
          const posResp = await fetch("/api/positions", { cache: "no-store" });
          const posJson = await terminalFetchJson<{
            ok: boolean;
            positions?: Array<{ symbol: string | null; marketValue: number | null }>;
          }>(posResp, "positions");
          if (!posJson.ok) {
            setPositionMvBySym(new Map());
            return;
          }
          const mvBySym = new Map<string, number>();
          for (const p of posJson.positions ?? []) {
            const sym = (p.symbol ?? "").toUpperCase().trim();
            if (!sym || sym === "CASH") continue;
            const mv = p.marketValue;
            if (mv == null || !Number.isFinite(mv) || mv === 0) continue;
            mvBySym.set(sym, (mvBySym.get(sym) ?? 0) + mv);
          }

          setPositionMvBySym(mvBySym);
          void loadExposureWeighting();
        } catch {
          // ignore
        }
      })();
    }, 5000);
    return () => clearTimeout(t);
  }, [quotes, lastUpdatedAt]);


  useMarketAwareInterval(() => void loadUsMarkets(), 60_000, 600_000, "us-markets", true);

  useEffect(() => {
    let five: ReturnType<typeof setInterval> | null = null;
    const run = () => void loadFutures();
    void run();
    const sync = () => {
      if (isUsEquityPreOpenFuturesPollWindow(new Date())) {
        if (five == null) {
          void run();
          five = setInterval(run, 300_000);
        }
      } else if (five != null) {
        clearInterval(five);
        five = null;
      }
    };
    sync();
    const meta = setInterval(sync, 60_000);
    return () => {
      clearInterval(meta);
      if (five != null) clearInterval(five);
    };
  }, []);

  function toggleSort(c: SortCol) {
    if (sortCol === c) setSortAsc((v) => !v);
    else {
      setSortCol(c);
      setSortAsc(c === "symbol" || c === "company" ? true : false);
    }
  }

  const portfolioSymbolSet = useMemo(() => new Set(symbols.map((s) => s.toUpperCase())), [symbols]);

  const sortedQuotes = useMemo(() => {
    const a = quotes.filter((q) => portfolioSymbolSet.has(q.symbol.toUpperCase()));
    a.sort((x, y) => {
      let cmp = 0;
      switch (sortCol) {
        case "symbol":
          cmp = x.symbol.localeCompare(y.symbol, undefined, { numeric: true, sensitivity: "base" });
          break;
        case "company": {
          const na = (companyBySymbol.get(x.symbol.toUpperCase()) ?? "").toLowerCase();
          const nb = (companyBySymbol.get(y.symbol.toUpperCase()) ?? "").toLowerCase();
          cmp = na.localeCompare(nb, undefined, { sensitivity: "base" });
          break;
        }
        case "last":
          cmp = (num(x.last) ?? -Infinity) - (num(y.last) ?? -Infinity);
          break;
        case "chgPct":
          cmp = (num(x.changePercent) ?? -Infinity) - (num(y.changePercent) ?? -Infinity);
          break;
        case "chg":
          cmp = (num(x.change) ?? -Infinity) - (num(y.change) ?? -Infinity);
          break;
        case "volume":
          cmp = (num(x.volume) ?? -Infinity) - (num(y.volume) ?? -Infinity);
          break;
        case "volX": {
          const ax = volumeInfo.get(x.symbol)?.ratio ?? -Infinity;
          const bx = volumeInfo.get(y.symbol)?.ratio ?? -Infinity;
          cmp = ax - bx;
          break;
        }
      }
      if (cmp === 0) cmp = x.symbol.localeCompare(y.symbol);
      return sortAsc ? cmp : -cmp;
    });
    return a;
  }, [quotes, portfolioSymbolSet, sortCol, sortAsc, volumeInfo, companyBySymbol]);

  const volumeLeaders = useMemo(() => {
    const rows = quotes
      .map((q) => {
        const v = volumeInfo.get(q.symbol);
        return { q, vol: q.volume ?? null, ratio: v?.ratio ?? null, flagged: v?.flagged ?? false };
      })
      .filter((r) => r.vol != null || r.ratio != null);

    rows.sort((a, b) => {
      if (volumeLeadersMode === "volX") {
        const cmp = (a.ratio ?? -Infinity) - (b.ratio ?? -Infinity);
        if (cmp !== 0) return -cmp;
        return ((b.vol ?? -Infinity) - (a.vol ?? -Infinity)) || a.q.symbol.localeCompare(b.q.symbol);
      }
      const cmp = (a.vol ?? -Infinity) - (b.vol ?? -Infinity);
      if (cmp !== 0) return -cmp;
      return ((b.ratio ?? -Infinity) - (a.ratio ?? -Infinity)) || a.q.symbol.localeCompare(b.q.symbol);
    });

    return rows.slice(0, 10);
  }, [quotes, volumeInfo, volumeLeadersMode]);

  const changePctBySymbol = useMemo(() => {
    const m = new Map<string, number | null | undefined>();
    for (const q of quotes) m.set(q.symbol.toUpperCase(), q.changePercent);
    return m;
  }, [quotes]);

  const optionFlowRows = useMemo(() => {
    const rows = (optionFlow?.items ?? []).map((it) => ({
      ...it,
      relativeVolume: it.relativeVolume ?? null,
      flagged: it.relativeVolume != null && it.relativeVolume >= 2.5,
    }));

    rows.sort((a, b) => {
      if (optionFlowMode === "relative") {
        const cmp = (a.relativeVolume ?? -Infinity) - (b.relativeVolume ?? -Infinity);
        if (cmp !== 0) return -cmp;
        return b.totalOptionVolume - a.totalOptionVolume || a.symbol.localeCompare(b.symbol);
      }
      const cmp = b.totalOptionVolume - a.totalOptionVolume;
      if (cmp !== 0) return cmp;
      return ((b.relativeVolume ?? -Infinity) - (a.relativeVolume ?? -Infinity)) || a.symbol.localeCompare(b.symbol);
    });

    return rows.slice(0, 10);
  }, [optionFlow, optionFlowMode]);

  const updatedLabel = useMemo(() => {
    if (!lastUpdatedAt) return "—";
    const ms = nowMs - new Date(lastUpdatedAt).getTime();
    if (!Number.isFinite(ms)) return "—";
    const sec = Math.max(0, Math.round(ms / 1000));
    if (sec < 60) return `${sec}s ago`;
    const min = Math.round(sec / 60);
    return `${min}m ago`;
  }, [lastUpdatedAt, nowMs]);

  const rthOpen = useMemo(() => isUsEquityRegularSessionOpen(new Date(clockTick)), [clockTick]);

  const newsFocusSymbols = useMemo(() => {
    const out = new Set<string>();
    for (const q of movers?.gainers?.slice(0, 6) ?? []) out.add(q.symbol.toUpperCase());
    for (const q of movers?.losers?.slice(0, 6) ?? []) out.add(q.symbol.toUpperCase());
    for (const s of symbols.slice(0, 8)) out.add(s.toUpperCase());
    return [...out].slice(0, 12);
  }, [movers, symbols]);

  const newsAnomalySymbols = useMemo(() => {
    return volumeLeaders.filter((r) => r.flagged).map((r) => r.q.symbol).slice(0, 8);
  }, [volumeLeaders]);

  return (
    <div className="flex w-full max-w-7xl flex-1 flex-col gap-6 py-8 pl-4 pr-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Terminal</h1>
          <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Portfolio-aware quote monitor (holdings + option underlyings) with a big-name movers board. Live equity refresh runs every 60 seconds during US RTH only (09:30–16:00 ET).
          </p>
          {!rthOpen ? (
            <p className="mt-2 text-xs font-medium text-amber-800 dark:text-amber-200">
              Market closed — equity live refresh is paused. Futures (if configured) still update on their pre-open schedule.
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/connections"
            className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 shadow-sm hover:bg-zinc-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5"
          >
            Connections
          </Link>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950/30 dark:text-red-200">{error}</div>
      ) : null}

      <DraggableTileLayout
        storageKey="fh.terminal.tiles.v1"
        defaultOrder={["quick-glance", "futures", "watchlist"]}
        tiles={{
          "quick-glance": {
            title: "Quick glance (today)",
            children: <UsMarketsPanel usMarkets={usMarkets} />,
          },
          futures: {
            title: "Futures",
            visible: futuresItems.length > 0,
            children: (
              <>
            <div className="text-[11px] text-zinc-600 dark:text-zinc-400">
              Set <span className="font-mono">TERMINAL_FUTURES_SYMBOLS</span> (e.g. <span className="font-mono">/ESM6,/NQM6</span>). Pre-open: every 5 min 08:30–09:30 ET; one fetch on load.
            </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {futuresItems.map((row) => {
              const last = row.quote.last ?? row.quote.mark;
              const pctPts = row.quote.changePercent == null ? null : row.quote.changePercent * 100;
              const chartData = row.series.map((p, idx) => ({ idx, c: p.close }));
              return (
                <div
                  key={row.symbol}
                  className="rounded-xl border border-zinc-300 bg-white/70 p-3 dark:border-white/20 dark:bg-black/20"
                >
                  <div className="font-mono text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    <SymbolLink symbol={row.symbol} className="font-mono font-semibold hover:no-underline">
                      {row.symbol}
                    </SymbolLink>
                  </div>
                  <div className="mt-1 grid grid-cols-2 gap-1 text-xs tabular-nums text-zinc-700 dark:text-zinc-300">
                    <div>Last</div>
                    <div className="text-right font-medium">{last == null ? "—" : last.toFixed(2)}</div>
                    <div>Chg %</div>
                    <div className={"text-right font-medium " + posNegClass(pctPts)}>{pctPts == null ? "—" : `${PCT2.format(pctPts)}%`}</div>
                  </div>
                  {chartData.length >= 2 ? (
                    <div className="mt-2 h-24 w-full min-w-0">
                      <ResponsiveContainer
                        width="100%"
                        height="100%"
                        minWidth={64}
                        minHeight={96}
                        initialDimension={{ width: 200, height: 96 }}
                      >
                        <LineChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                          <Line type="monotone" dataKey="c" dot={false} strokeWidth={1.5} stroke="#0f766e" />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <div className="mt-2 text-[11px] text-zinc-500">No history cached yet.</div>
                  )}
                </div>
              );
            })}
          </div>
              </>
            ),
          },
          watchlist: {
            title: "Watchlist & quotes",
            bodyClassName: "p-4 sm:p-6",
            children: (
        <DraggableTileLayout
          storageKey="fh.terminal.watchlist.tiles.v1"
          hint={null}
          className="flex flex-col gap-4"
          defaultOrder={["watchlist-controls", "heatmap", "treemap", "news", "quotes-table", "market-sidebar"]}
          tiles={{
            "watchlist-controls": {
              title: "Watchlist overlay",
              bodyClassName: "p-4",
              children: (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={watchlistId ?? ""}
              onChange={(e) => {
                const next = e.target.value || null;
                setWatchlistId(next);
                void refreshAll(next);
              }}
              className="h-9 rounded-lg border border-zinc-300 bg-white px-2 text-sm text-zinc-900 shadow-sm dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100"
            >
              <option value="">(none)</option>
              {watchlists.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} ({w.itemCount})
                </option>
              ))}
            </select>
            <Link href="/terminal/watchlists" className="text-sm font-medium text-zinc-900 underline-offset-4 hover:underline dark:text-zinc-100">
              Manage
            </Link>
          </div>
          <div className="text-sm text-zinc-600 dark:text-zinc-400">
            {symbols.length} symbols • Updated {updatedLabel}
          </div>
        </div>
              ),
            },
            heatmap: {
              title: "Market heatmap (tile size ∝ cap, color = day %)",
              bodyClassName: "p-4",
              children: (
                <>
              <div className="flex flex-wrap items-center justify-end gap-1">
                {(
                  [
                    { key: "spy", label: "SPY" },
                    { key: "qqq", label: "QQQ" },
                    { key: "portfolio", label: "Net portfolio" },
                  ] as const
                ).map((v) => (
                  <button
                    key={v.key}
                    type="button"
                    onClick={() => setHeatView(v.key)}
                    className={
                      "h-9 min-w-[5.5rem] whitespace-nowrap rounded-md px-3 text-sm font-semibold " +
                      (heatView === v.key
                        ? "bg-zinc-950 text-white dark:bg-white dark:text-black"
                        : "border border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5")
                    }
                  >
                    {v.label}
                  </button>
                ))}
              </div>
          <div className="mt-3 min-w-0">
            <HeatmapGrid items={heatItems.slice(0, 220)} companyNamesBySymbol={companyBySymbol} />
            {heatItems.length === 0 ? <div className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">No heatmap data yet.</div> : null}
          </div>
                </>
              ),
            },
            treemap: {
              title: "Position treemap (size = weight, color = day %)",
              bodyClassName: "p-4",
              children: (
                <PortfolioTreemapSection
                  heatView={heatView}
                  heatItems={heatItems}
                  companyNamesBySymbol={companyBySymbol}
                  treemapScope={treemapScope}
                  onScopeChange={setTreemapScope}
                  treemapMetric={treemapMetric}
                  onPieMetricChange={setTreemapMetric}
                  treemapSyntheticBasis={treemapSyntheticBasis}
                  onSyntheticChartBasisChange={setTreemapSyntheticBasis}
                  treemapMvBySym={treemapMvBySym}
                  positionMvBySym={positionMvBySym}
                  portfolioSizeCaption={treemapSizeCaption}
                />
              ),
            },
            news: {
              title: "Market news",
              bodyClassName: "p-4",
              children: (
                <NewsDigestSection symbols={newsFocusSymbols} anomalySymbols={newsAnomalySymbols} />
              ),
            },
            "quotes-table": {
              title: "Quotes",
              bodyClassName: "p-0",
              children: (
            <div className="min-w-0 overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-zinc-300 bg-zinc-50 text-left text-zinc-600 dark:border-white/20 dark:bg-zinc-900/40 dark:text-zinc-400">
                  {colOrder.map((c) => {
                    const label =
                      c === "symbol"
                        ? "Symbol"
                        : c === "company"
                          ? "Company"
                          : c === "last"
                            ? "Last"
                            : c === "chg"
                              ? "$ Chg"
                              : c === "chgPct"
                                ? "% Chg"
                                : c === "volume"
                                  ? "Volume"
                                  : "Vol ×";
                    const align = c === "symbol" || c === "company" ? "left" : "right";
                    const colActive = sortCol === c;
                    const ariaSort = colActive ? (sortAsc ? "ascending" : "descending") : "none";
                    return (
                      <th
                        key={c}
                        draggable
                        aria-sort={ariaSort}
                        onDragStart={(e) => {
                          e.dataTransfer.setData("text/plain", c);
                          e.dataTransfer.effectAllowed = "move";
                        }}
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.dataTransfer.dropEffect = "move";
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          const from = e.dataTransfer.getData("text/plain") as TerminalCol;
                          if (!from || from === c) return;
                          const allowedCols = new Set<TerminalCol>([
                            "symbol",
                            "company",
                            "last",
                            "chg",
                            "chgPct",
                            "volume",
                            "volX",
                          ]);
                          if (!allowedCols.has(from)) return;
                          setColOrder((prev) => {
                            const next = [...prev];
                            const i = next.indexOf(from);
                            const j = next.indexOf(c);
                            if (i < 0 || j < 0) return prev;
                            next.splice(i, 1);
                            next.splice(j, 0, from);
                            return next;
                          });
                        }}
                        title="Drag to reorder columns"
                        className={
                          "py-2 pr-4 font-medium " + (align === "right" ? "text-right" : "text-left")
                        }
                      >
                        <SortTh col={c} label={label} sortCol={sortCol} sortAsc={sortAsc} onToggle={toggleSort} align={align as "left" | "right"} />
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {sortedQuotes.map((q) => {
                  const chg = q.change ?? null;
                  const chgPct = q.changePercent == null ? null : q.changePercent * 100;
                  const v = volumeInfo.get(q.symbol);
                  const spot = quoteDisplaySpot(q);
                  return (
                    <tr
                      key={q.symbol}
                      className="border-b border-zinc-200 hover:bg-zinc-50/70 dark:border-white/20 dark:hover:bg-white/5"
                    >
                      {colOrder.map((c) => {
                        switch (c) {
                          case "symbol":
                            return (
                              <td key={c} className="py-2 pr-4 font-semibold">
                                <SymbolLink symbol={q.symbol}>{q.symbol}</SymbolLink>
                              </td>
                            );
                          case "company": {
                            const cn = companyBySymbol.get(q.symbol.toUpperCase()) ?? "";
                            return (
                              <td key={c} className="max-w-[16rem] py-2 pr-4 text-left align-top text-sm text-zinc-700 dark:text-zinc-300">
                                <span className="line-clamp-2" title={cn || undefined}>
                                  {cn || "—"}
                                </span>
                              </td>
                            );
                          }
                          case "last":
                            return (
                              <td
                                key={c}
                                className={
                                  "py-2 pr-4 text-right tabular-nums " + priceDirClass(spot, q.close)
                                }
                              >
                                {spot == null ? "—" : spot.toFixed(2)}
                              </td>
                            );
                          case "chg":
                            return (
                              <td key={c} className={"py-2 pr-4 text-right tabular-nums " + posNegClass(chg)}>
                                {chg == null ? "—" : usd2Masked(chg, privacy.masked)}
                              </td>
                            );
                          case "chgPct":
                            return (
                              <td key={c} className={"py-2 pr-4 text-right tabular-nums " + posNegClass(chgPct)}>
                                {chgPct == null ? "—" : PCT2.format(chgPct) + "%"}
                              </td>
                            );
                          case "volume":
                            return (
                              <td key={c} className="py-2 pr-4 text-right tabular-nums">
                                {q.volume == null ? "—" : Math.round(q.volume).toLocaleString()}
                              </td>
                            );
                          case "volX":
                            return (
                              <td key={c} className={"py-2 pr-4 text-right tabular-nums " + (v?.flagged ? "font-semibold text-amber-700 dark:text-amber-300" : "text-zinc-600 dark:text-zinc-400")}>
                                {volRatioLabel(v?.ratio ?? null)}
                              </td>
                            );
                        }
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
              ),
            },
            "market-sidebar": {
              title: "Movers, options & volume",
              bodyClassName: "p-4",
              children: (
                <>
              {movers?.ok === false ? (
                <div className="text-xs text-red-700 dark:text-red-300">{movers.error ?? "Failed to load movers"}</div>
              ) : null}

              <div className="text-sm font-semibold">Movers</div>
              <div className="mt-2 grid grid-cols-2 gap-3">
                <div>
                  <div className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">Top gainers</div>
                  <div className="mt-1 grid gap-1">
                    {(movers?.gainers ?? []).slice(0, 8).map((q) => (
                      <SymbolLink
                        key={q.symbol}
                        symbol={q.symbol}
                        style={sentimentRowBackground(q.changePercent)}
                        title="Open symbol"
                        className="relative flex w-full items-center justify-between overflow-hidden rounded-md border border-zinc-300 bg-white/70 px-2 py-1 text-xs hover:no-underline dark:border-white/15 dark:bg-zinc-950/40"
                      >
                        <span className="font-semibold">{q.symbol}</span>
                        <span className={"tabular-nums " + posNegClass(q.changePercent == null ? null : q.changePercent * 100)}>
                          {q.changePercent == null ? "—" : PCT2.format(q.changePercent * 100) + "%"}
                        </span>
                      </SymbolLink>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">Top losers</div>
                  <div className="mt-1 grid gap-1">
                    {(movers?.losers ?? []).slice(0, 8).map((q) => (
                      <SymbolLink
                        key={q.symbol}
                        symbol={q.symbol}
                        style={sentimentRowBackground(q.changePercent)}
                        title="Open symbol"
                        className="relative flex w-full items-center justify-between overflow-hidden rounded-md border border-zinc-300 bg-white/70 px-2 py-1 text-xs hover:no-underline dark:border-white/15 dark:bg-zinc-950/40"
                      >
                        <span className="font-semibold">{q.symbol}</span>
                        <span className={"tabular-nums " + posNegClass(q.changePercent == null ? null : q.changePercent * 100)}>
                          {q.changePercent == null ? "—" : PCT2.format(q.changePercent * 100) + "%"}
                        </span>
                      </SymbolLink>
                    ))}
                  </div>
                </div>
              </div>

              <OptionFlowPanel
                optionFlow={optionFlow}
                optionFlowMode={optionFlowMode}
                onModeChange={setOptionFlowMode}
                optionFlowRows={optionFlowRows}
                changePctBySymbol={changePctBySymbol}
              />
              <div className="mt-5">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold">Volume leaders</div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setVolumeLeadersMode("volume")}
                      className={
                        "h-9 min-w-[3.25rem] whitespace-nowrap rounded-md px-3 text-sm font-semibold " +
                        (volumeLeadersMode === "volume"
                          ? "bg-zinc-950 text-white dark:bg-white dark:text-black"
                          : "border border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5")
                      }
                      title="Sort by raw volume"
                    >
                      Vol
                    </button>
                    <button
                      type="button"
                      onClick={() => setVolumeLeadersMode("volX")}
                      className={
                        "h-9 min-w-[3.25rem] whitespace-nowrap rounded-md px-3 text-sm font-semibold " +
                        (volumeLeadersMode === "volX"
                          ? "bg-zinc-950 text-white dark:bg-white dark:text-black"
                          : "border border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5")
                      }
                      title="Sort by unusual volume multiple (Vol×)"
                    >
                      Vol×
                    </button>
                  </div>
                </div>
                <div className="mt-1 text-[11px] text-zinc-600 dark:text-zinc-400">From your terminal universe (portfolio + watchlist overlay)</div>
                <div className="mt-2 grid gap-1">
                  {volumeLeaders.slice(0, 8).map(({ q, vol, ratio, flagged }) => (
                    <SymbolLink
                      key={q.symbol}
                      symbol={q.symbol}
                      style={sentimentRowBackground(q.changePercent)}
                      title="Open symbol"
                      className="relative flex w-full items-center justify-between overflow-hidden rounded-md border border-zinc-300 bg-white/70 px-2 py-1 text-xs hover:no-underline dark:border-white/15 dark:bg-zinc-950/40"
                    >
                      <span className="font-semibold">{q.symbol}</span>
                      <span className="flex items-center gap-2 tabular-nums">
                        <span className={"w-[4.5rem] text-right " + posNegClass(q.changePercent == null ? null : q.changePercent * 100)}>
                          {q.changePercent == null ? "—" : PCT2.format(q.changePercent * 100) + "%"}
                        </span>
                        <span className={flagged ? "font-semibold text-amber-700 dark:text-amber-300" : "text-zinc-600 dark:text-zinc-400"}>
                          {volRatioLabel(ratio)}
                        </span>
                        <span className="text-zinc-700 dark:text-zinc-300">{vol == null ? "—" : Math.round(vol).toLocaleString()}</span>
                      </span>
                    </SymbolLink>
                  ))}
                  {volumeLeaders.length === 0 ? <div className="text-sm text-zinc-600 dark:text-zinc-400">No volume data yet.</div> : null}
                </div>
              </div>
                </>
              ),
            },
          }}
        />
            ),
          },
        }}
      />
    </div>
  );
}


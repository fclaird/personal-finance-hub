"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { AccountPositionsForAllocation } from "@/app/components/AccountPositionsForAllocation";
import { DraggableControlColumn } from "@/app/components/DraggableControlColumn";
import { SymbolLink } from "@/app/components/SymbolLink";
import { AllocationWeightingChart } from "@/app/components/allocation/AllocationWeightingChart";
import { FinancePiePanel } from "@/app/components/FinancePiePanel";
import { useSchwabRefreshCoordinator } from "@/hooks/useSchwabRefreshCoordinator";
import { usePrivacy } from "@/app/components/PrivacyProvider";
import { assignEarthToneColorsBySymbols } from "@/lib/charts/pieEarthTones";
import { formatUsd2 } from "@/lib/format";
import { posNegClass } from "@/lib/terminal/colors";

type ExposureRow = {
  underlyingSymbol: string;
  spotMarketValue: number;
  heldShares: number;
  syntheticMarketValue: number;
  syntheticShares: number;
  /** Options liquidating value: sum of option contract `market_value` for this underlying. */
  optionsMarkMarketValue: number;
};

type SortColumn =
  | "underlying"
  | "spot"
  | "synthetic"
  | "optionsLiquidating"
  | "netLiquidating"
  | "net"
  | "syntheticShares"
  | "heldShares"
  | "netShares"
  | "pct";
type ClassSortColumn = "key" | "mv" | "weight";

type PieMetric = "spot" | "synthetic" | "net";

function sliceMv(r: ExposureRow, metric: PieMetric): number {
  switch (metric) {
    case "spot":
      return r.spotMarketValue;
    case "synthetic":
      return r.syntheticMarketValue;
    case "net":
      return r.spotMarketValue + r.syntheticMarketValue;
    default:
      return 0;
  }
}

function chartSyntheticMv(r: ExposureRow, basis: "delta" | "mark"): number {
  return basis === "mark" ? r.optionsMarkMarketValue : r.syntheticMarketValue;
}

/** Spot (shares) MV + options liquidating value (contract marks). */
function netLiquidatingMv(r: ExposureRow): number {
  return r.spotMarketValue + r.optionsMarkMarketValue;
}

function netShares(r: ExposureRow) {
  return (r.heldShares ?? 0) + (r.syntheticShares ?? 0);
}

const PIE_METRIC_LABEL: Record<PieMetric, string> = {
  spot: "Spot",
  synthetic: "Synthetic",
  net: "Net",
};

const PCT2 = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function usd2Masked(v: number, masked: boolean) {
  return formatUsd2(v, { mask: masked });
}

function SortTh<T extends string>({
  col,
  label,
  sortColumn,
  sortAsc,
  onToggle,
  className,
}: {
  col: T;
  label: string;
  sortColumn: T;
  sortAsc: boolean;
  onToggle: (col: T) => void;
  className?: string;
}) {
  const active = sortColumn === col;
  const arrow = active ? (sortAsc ? " ▲" : " ▼") : "";
  const ariaSort = active ? (sortAsc ? "ascending" : "descending") : "none";
  return (
    <th className={className} aria-sort={ariaSort}>
      <button
        type="button"
        onClick={() => onToggle(col)}
        className="inline-flex items-center gap-1 hover:underline underline-offset-4"
      >
        <span>{label}</span>
        <span className="text-[10px] opacity-70">{arrow}</span>
      </button>
    </th>
  );
}

function AccountAssetClassTable({
  rows,
  masked,
}: {
  rows: Array<{ key: string; marketValue: number; weight: number }>;
  masked: boolean;
}) {
  const [col, setCol] = useState<ClassSortColumn>("mv");
  const [asc, setAsc] = useState(false);

  function toggle(c: ClassSortColumn) {
    if (col === c) setAsc(!asc);
    else {
      setCol(c);
      setAsc(c === "key" ? true : false);
    }
  }

  const totalMv = useMemo(() => rows.reduce((s, r) => s + (r.marketValue ?? 0), 0), [rows]);

  const sorted = useMemo(() => {
    const a = [...rows];
    a.sort((x, y) => {
      let cmp = 0;
      switch (col) {
        case "key":
          cmp = x.key.localeCompare(y.key, undefined, { numeric: true, sensitivity: "base" });
          break;
        case "mv":
          cmp = x.marketValue - y.marketValue;
          break;
        case "weight":
          cmp = x.weight - y.weight;
          break;
      }
      if (cmp === 0) cmp = x.key.localeCompare(y.key);
      return asc ? cmp : -cmp;
    });
    return a;
  }, [rows, col, asc]);

  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-zinc-300 text-left text-zinc-600 dark:border-white/20 dark:text-zinc-400">
          <SortTh
            col="key"
            label="Class"
            sortColumn={col}
            sortAsc={asc}
            onToggle={toggle}
            className="py-2 pr-4 font-medium"
          />
          <SortTh
            col="mv"
            label="Market value"
            sortColumn={col}
            sortAsc={asc}
            onToggle={toggle}
            className="py-2 pr-4 text-right font-medium"
          />
          <SortTh
            col="weight"
            label="Weight"
            sortColumn={col}
            sortAsc={asc}
            onToggle={toggle}
            className="py-2 pr-4 text-right font-medium"
          />
        </tr>
      </thead>
      <tbody>
        {rows.length ? (
          <tr className="border-b border-zinc-200 bg-zinc-50/60 font-semibold text-zinc-900 dark:border-white/20 dark:bg-white/5 dark:text-zinc-100">
            <td className="py-2 pr-4">TOTAL</td>
            <td className={"py-2 pr-4 text-right tabular-nums " + posNegClass(totalMv)}>{usd2Masked(totalMv, masked)}</td>
            <td className="py-2 pr-4 text-right tabular-nums">100.00%</td>
          </tr>
        ) : null}
        {sorted.map((b) => (
          <tr key={b.key} className="border-b border-zinc-200 dark:border-white/20">
            <td className="py-2 pr-4 font-medium">{b.key}</td>
            <td className={"py-2 pr-4 text-right tabular-nums " + posNegClass(b.marketValue)}>{usd2Masked(b.marketValue, masked)}</td>
            <td className="py-2 pr-4 text-right tabular-nums">{PCT2.format(b.weight * 100)}%</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Second line of pie card title when weight mode is not full net. */
function pieMetricChartSubtitle(metric: PieMetric): string {
  switch (metric) {
    case "spot":
      return "Spot";
    case "synthetic":
      return "Synthetic";
    case "net":
      return "Spot + synthetic";
    default:
      return "";
  }
}

/** Compact segment controls: equal columns, right-aligned in row. */
const BTN_CLASSES =
  "flex h-8 w-full min-w-0 items-center justify-center whitespace-nowrap rounded-md px-2 text-xs font-semibold tracking-tight";

export default function AllocationPage() {
  const privacy = usePrivacy();
  const [rows, setRows] = useState<ExposureRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pieView, setPieView] = useState<"net" | "retirement" | "brokerage">("net");
  const [pieMetric, setPieMetric] = useState<PieMetric>("net");
  /** Pie + bar charts only: delta-weighted synthetic MV vs options liquidating value (contract marks). Table % / Net MV stay delta-based. */
  const [syntheticChartBasis, setSyntheticChartBasis] = useState<"delta" | "mark">("delta");
  const [detail, setDetail] = useState<
    Map<
      string,
      {
        impliedPrice: number | null;
        syntheticShares: number | null;
        syntheticMarketValue: number | null;
        contributors: Array<{ optionSymbol: string; quantity: number; delta: number | null; syntheticShares: number }>;
      }
    >
  >(new Map());
  const [sortColumn, setSortColumn] = useState<SortColumn>("net");
  const [sortAsc, setSortAsc] = useState(false);
  const [classSortColumn, setClassSortColumn] = useState<ClassSortColumn>("mv");
  const [classSortAsc, setClassSortAsc] = useState(false);
  const [assetClass, setAssetClass] = useState<Array<{ key: string; marketValue: number; weight: number }>>([]);
  const [accounts, setAccounts] = useState<
    Array<{
      accountId: string;
      accountName: string;
      totalMarketValue: number;
      byAssetClass: Array<{ key: string; marketValue: number; weight: number }>;
    }>
  >([]);
  const [exposureBuckets, setExposureBuckets] = useState<
    Array<{
      bucketKey: "brokerage" | "retirement";
      exposure: ExposureRow[];
    }>
  >([]);

  async function load() {
    setError(null);
    const pageDataResp = await fetch(`/api/allocation/page-data?synthetic=1`);

    async function safeJson(resp: Response) {
      const text = await resp.text();
      try {
        return JSON.parse(text) as unknown;
      } catch {
        const url = resp.url || "(unknown url)";
        throw new Error(
          `Non-JSON response (${resp.status}) from ${url}: ${text ? text.slice(0, 300) : "(empty body)"}`,
        );
      }
    }

    const pageDataJson = (await safeJson(pageDataResp)) as {
      ok: boolean;
      exposure?: ExposureRow[];
      byAssetClass?: Array<{ key: string; marketValue: number; weight: number }>;
      accounts?: Array<{
        accountId: string;
        accountName: string;
        totalMarketValue: number;
        byAssetClass: Array<{ key: string; marketValue: number; weight: number }>;
      }>;
      error?: string;
    };
    if (!pageDataJson.ok) throw new Error(pageDataJson.error ?? "Failed to load allocation page data");
    setRows(
      (pageDataJson.exposure ?? []).map((r) => ({
        ...r,
        optionsMarkMarketValue: typeof r.optionsMarkMarketValue === "number" ? r.optionsMarkMarketValue : 0,
      })),
    );

    setAssetClass(pageDataJson.byAssetClass ?? []);
    setAccounts(pageDataJson.accounts ?? []);

    void (async () => {
      const exposureBucketResp = await fetch(`/api/exposure/buckets`);
      const expBucketJson = (await safeJson(exposureBucketResp)) as {
        ok: boolean;
        buckets?: Array<{ bucketKey: "brokerage" | "retirement"; exposure: ExposureRow[] }>;
        error?: string;
      };
      if (!expBucketJson.ok) throw new Error(expBucketJson.error ?? "Failed to load exposure buckets");
      setExposureBuckets(
        (expBucketJson.buckets ?? []).map((b) => ({
          ...b,
          exposure: (b.exposure ?? []).map((r) => ({
            ...r,
            optionsMarkMarketValue: typeof r.optionsMarkMarketValue === "number" ? r.optionsMarkMarketValue : 0,
          })),
        })),
      );
    })().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }

  useSchwabRefreshCoordinator({
    onTick: () => load().catch((e) => setError(e instanceof Error ? e.message : String(e))),
  });

  function toggleSort(col: SortColumn) {
    if (sortColumn === col) setSortAsc(!sortAsc);
    else {
      setSortColumn(col);
      // Default: strings asc, numbers desc.
      setSortAsc(col === "underlying" ? true : false);
    }
  }

  function toggleClassSort(col: ClassSortColumn) {
    if (classSortColumn === col) setClassSortAsc(!classSortAsc);
    else {
      setClassSortColumn(col);
      setClassSortAsc(col === "key" ? true : false);
    }
  }

  const sortedAssetClass = useMemo(() => {
    const a = [...assetClass];
    a.sort((x, y) => {
      let cmp = 0;
      switch (classSortColumn) {
        case "key":
          cmp = x.key.localeCompare(y.key, undefined, { numeric: true, sensitivity: "base" });
          break;
        case "mv":
          cmp = x.marketValue - y.marketValue;
          break;
        case "weight":
          cmp = x.weight - y.weight;
          break;
      }
      if (cmp === 0) cmp = x.key.localeCompare(y.key);
      return classSortAsc ? cmp : -cmp;
    });
    return a;
  }, [assetClass, classSortColumn, classSortAsc]);

  const scopedRows = useMemo(() => {
    if (pieView === "net") return rows;
    const b = exposureBuckets.find((x) => x.bucketKey === pieView);
    return b?.exposure ?? [];
  }, [rows, exposureBuckets, pieView]);

  /** Whole-portfolio synthetic MV (for hint when Net vs Spot would match). */
  const portfolioSynthMv = useMemo(() => rows.reduce((s, r) => s + r.syntheticMarketValue, 0), [rows]);
  const showSyntheticZeroHint = rows.length > 0 && Math.abs(portfolioSynthMv) < 1e-6;

  /** Denominator for % + pie for active metric + scope. */
  const scopedMetricTotal = useMemo(() => scopedRows.reduce((s, r) => s + sliceMv(r, pieMetric), 0), [scopedRows, pieMetric]);

  const chartScopedRows = useMemo(
    () =>
      scopedRows.map((r) => ({
        ...r,
        syntheticMarketValue: chartSyntheticMv(r, syntheticChartBasis),
      })),
    [scopedRows, syntheticChartBasis],
  );

  const chartScopedMetricTotal = useMemo(
    () => chartScopedRows.reduce((s, r) => s + sliceMv(r, pieMetric), 0),
    [chartScopedRows, pieMetric],
  );

  /** One color per underlying (alphabetical palette) shared by pie, bars, and history line. */
  const chartSymbolColors = useMemo(
    () => assignEarthToneColorsBySymbols(chartScopedRows.map((r) => r.underlyingSymbol.trim()).filter(Boolean)),
    [chartScopedRows],
  );

  const sortedRows = useMemo(() => {
    const rs = [...scopedRows];
    const getNet = (r: ExposureRow) => r.spotMarketValue + r.syntheticMarketValue;
    const getPct = (r: ExposureRow) => (scopedMetricTotal ? sliceMv(r, pieMetric) / scopedMetricTotal : 0);
    rs.sort((a, b) => {
      let cmp = 0;
      switch (sortColumn) {
        case "underlying":
          cmp = a.underlyingSymbol.localeCompare(b.underlyingSymbol, undefined, { numeric: true, sensitivity: "base" });
          break;
        case "spot":
          cmp = a.spotMarketValue - b.spotMarketValue;
          break;
        case "synthetic":
          cmp = a.syntheticMarketValue - b.syntheticMarketValue;
          break;
        case "optionsLiquidating":
          cmp = a.optionsMarkMarketValue - b.optionsMarkMarketValue;
          break;
        case "netLiquidating":
          cmp = netLiquidatingMv(a) - netLiquidatingMv(b);
          break;
        case "net":
          cmp = getNet(a) - getNet(b);
          break;
        case "syntheticShares":
          cmp = a.syntheticShares - b.syntheticShares;
          break;
        case "heldShares":
          cmp = (a.heldShares ?? 0) - (b.heldShares ?? 0);
          break;
        case "netShares":
          cmp = netShares(a) - netShares(b);
          break;
        case "pct":
          cmp = getPct(a) - getPct(b);
          break;
      }
      if (cmp === 0) cmp = a.underlyingSymbol.localeCompare(b.underlyingSymbol);
      return sortAsc ? cmp : -cmp;
    });
    return rs;
  }, [scopedRows, sortColumn, sortAsc, scopedMetricTotal, pieMetric]);

  async function ensureDetail(underlying: string) {
    const sym = (underlying ?? "").trim().toUpperCase();
    if (!sym) return;
    if (detail.has(sym)) return;
    try {
      const resp = await fetch(`/api/exposure/details?underlying=${encodeURIComponent(sym)}`, { cache: "no-store" });
      const json = (await resp.json()) as {
        ok: boolean;
        impliedPrice?: number | null;
        syntheticShares?: number | null;
        syntheticMarketValue?: number | null;
        contributors?: Array<{ optionSymbol: string; quantity: number; delta: number | null; syntheticShares: number }>;
      };
      if (!json.ok) return;
      setDetail((prev) => {
        const next = new Map(prev);
        next.set(sym, {
          impliedPrice: json.impliedPrice ?? null,
          syntheticShares: json.syntheticShares ?? null,
          syntheticMarketValue: json.syntheticMarketValue ?? null,
          contributors: json.contributors ?? [],
        });
        return next;
      });
    } catch {
      // ignore
    }
  }

  return (
    <div className="flex w-full min-w-0 max-w-[108rem] flex-1 flex-col gap-8 py-8 pl-4 pr-5 sm:py-10 sm:pl-6 sm:pr-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Allocation</h1>
          <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Exposure by underlying; pie chart switches Spot, Synthetic, or Net weights. Asset-class tables include delta-weighted option exposure in equities.{" "}
            <Link href="/diversification" className="font-medium text-zinc-900 underline-offset-4 hover:underline dark:text-zinc-100">
              Diversification
            </Link>{" "}
            has the same pie controls for sector / market cap / geography.
          </p>
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

      <section className="rounded-2xl border border-zinc-300 bg-white p-6 shadow-sm dark:border-white/20 dark:bg-zinc-950">
        {error ? (
          <div className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950/30 dark:text-red-200">
            {error}
          </div>
        ) : null}

        {showSyntheticZeroHint ? (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-900/40 dark:bg-amber-950/25 dark:text-amber-100">
            Synthetic exposure is <span className="font-semibold">$0</span> because option deltas are not loaded yet (Net and Spot weights match). Open{" "}
            <Link href="/connections" className="font-medium underline underline-offset-2">
              Connections
            </Link>{" "}
            and use <span className="font-medium">Refresh option greeks</span>, or stay on this page — greeks refresh runs after quotes on load and at most every 5 minutes while the market is open.
          </div>
        ) : null}

        <div className="mt-5 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-zinc-300 text-left text-zinc-600 dark:border-white/20 dark:text-zinc-400">
                <SortTh
                  col="underlying"
                  label="Underlying"
                  sortColumn={sortColumn}
                  sortAsc={sortAsc}
                  onToggle={toggleSort}
                  className="py-2 pr-4 font-medium"
                />
                <SortTh
                  col="spot"
                  label="Spot MV"
                  sortColumn={sortColumn}
                  sortAsc={sortAsc}
                  onToggle={toggleSort}
                  className="py-2 pr-4 text-right font-medium"
                />
                <SortTh
                  col="synthetic"
                  label="Synthetic MV"
                  sortColumn={sortColumn}
                  sortAsc={sortAsc}
                  onToggle={toggleSort}
                  className="py-2 pr-4 text-right font-medium"
                />
                <SortTh
                  col="optionsLiquidating"
                  label="Options liquidating value"
                  sortColumn={sortColumn}
                  sortAsc={sortAsc}
                  onToggle={toggleSort}
                  className="py-2 pr-4 text-right font-medium"
                />
                <SortTh
                  col="netLiquidating"
                  label="Net liquidating value"
                  sortColumn={sortColumn}
                  sortAsc={sortAsc}
                  onToggle={toggleSort}
                  className="py-2 pr-4 text-right font-medium"
                />
                <SortTh
                  col="net"
                  label="Net MV"
                  sortColumn={sortColumn}
                  sortAsc={sortAsc}
                  onToggle={toggleSort}
                  className="py-2 pr-4 text-right font-medium"
                />
                <SortTh
                  col="syntheticShares"
                  label="Synthetic shares"
                  sortColumn={sortColumn}
                  sortAsc={sortAsc}
                  onToggle={toggleSort}
                  className="py-2 pr-4 text-right font-medium"
                />
                <SortTh
                  col="heldShares"
                  label="Held shares"
                  sortColumn={sortColumn}
                  sortAsc={sortAsc}
                  onToggle={toggleSort}
                  className="py-2 pr-4 text-right font-medium"
                />
                <SortTh
                  col="netShares"
                  label="Net shares"
                  sortColumn={sortColumn}
                  sortAsc={sortAsc}
                  onToggle={toggleSort}
                  className="py-2 pr-4 text-right font-medium"
                />
                <SortTh
                  col="pct"
                  label="% of total"
                  sortColumn={sortColumn}
                  sortAsc={sortAsc}
                  onToggle={toggleSort}
                  className="py-2 pr-4 text-right font-medium"
                />
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((r) => {
                const netMv = r.spotMarketValue + r.syntheticMarketValue;
                const netLiq = netLiquidatingMv(r);
                const pct = scopedMetricTotal ? sliceMv(r, pieMetric) / scopedMetricTotal : 0;
                return (
                  <tr key={r.underlyingSymbol} className="border-b border-zinc-200 dark:border-white/20">
                    <td className="py-2 pr-4 font-medium">
                      <SymbolLink symbol={r.underlyingSymbol}>{r.underlyingSymbol}</SymbolLink>
                    </td>
                      <td className={"py-2 pr-4 text-right tabular-nums " + posNegClass(r.spotMarketValue)}>
                        {usd2Masked(r.spotMarketValue, privacy.masked)}
                      </td>
                      <td
                        className={"py-2 pr-4 text-right tabular-nums " + posNegClass(r.syntheticMarketValue)}
                        onMouseEnter={() => void ensureDetail(r.underlyingSymbol)}
                        title={(() => {
                          const d = detail.get(r.underlyingSymbol.trim().toUpperCase());
                          if (!d) return "Hover to load synthetic MV breakdown";
                          const px = d.impliedPrice;
                          const pxStr = px == null ? "n/a" : `$${px.toFixed(2)}`;
                          const sharesStr = d.syntheticShares == null ? "n/a" : d.syntheticShares.toFixed(2);
                          const lines = [
                            `Synthetic MV breakdown for ${r.underlyingSymbol}`,
                            `syntheticShares = Σ(positionQty × 100 × delta) = ${sharesStr}`,
                            `impliedPrice = ${pxStr}`,
                            `syntheticMV = syntheticShares × impliedPrice`,
                            `(implied price is portfolio-wide VWAP from non-option shares, same as the breakdown API.)`,
                            ``,
                            `Top contributors:`,
                            ...d.contributors.slice(0, 8).map((c) => {
                              const dlt = c.delta == null ? "—" : c.delta.toFixed(3);
                              return `${c.optionSymbol} | qty=${c.quantity} | delta=${dlt} | contribShares=${c.syntheticShares.toFixed(2)}`;
                            }),
                          ];
                          return lines.join("\n");
                        })()}
                      >
                        {usd2Masked(r.syntheticMarketValue, privacy.masked)}
                      </td>
                      <td className={"py-2 pr-4 text-right tabular-nums " + posNegClass(r.optionsMarkMarketValue)}>
                        {usd2Masked(r.optionsMarkMarketValue, privacy.masked)}
                      </td>
                      <td className={"py-2 pr-4 text-right tabular-nums " + posNegClass(netLiq)}>
                        {usd2Masked(netLiq, privacy.masked)}
                      </td>
                    <td className="py-2 pr-4 text-right tabular-nums font-medium text-zinc-900 dark:text-zinc-100">
                        <span className={posNegClass(netMv)}>{usd2Masked(netMv, privacy.masked)}</span>
                    </td>
                      <td className={"py-2 pr-4 text-right tabular-nums " + posNegClass(r.syntheticShares)}>
                        {(Number.isFinite(r.syntheticShares) ? r.syntheticShares : 0).toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </td>
                      <td className={"py-2 pr-4 text-right tabular-nums " + posNegClass(r.heldShares ?? 0)}>
                        {(r.heldShares ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className={"py-2 pr-4 text-right tabular-nums " + posNegClass(netShares(r))}>
                        {netShares(r).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                    <td className="py-2 pr-4 text-right tabular-nums">{PCT2.format(pct * 100)}%</td>
                  </tr>
                );
              })}
              {rows.length ? (
                <tr className="border-t border-zinc-300 bg-zinc-50/60 font-semibold text-zinc-900 dark:border-white/20 dark:bg-white/5 dark:text-zinc-100">
                  <td className="py-2 pr-4">TOTAL</td>
                  <td
                    className={
                      "py-2 pr-4 text-right tabular-nums " +
                      posNegClass(scopedRows.reduce((s, r) => s + r.spotMarketValue, 0))
                    }
                  >
                    {usd2Masked(scopedRows.reduce((s, r) => s + r.spotMarketValue, 0), privacy.masked)}
                  </td>
                  <td
                    className={
                      "py-2 pr-4 text-right tabular-nums " +
                      posNegClass(scopedRows.reduce((s, r) => s + r.syntheticMarketValue, 0))
                    }
                  >
                    {usd2Masked(scopedRows.reduce((s, r) => s + r.syntheticMarketValue, 0), privacy.masked)}
                  </td>
                  <td
                    className={
                      "py-2 pr-4 text-right tabular-nums " +
                      posNegClass(scopedRows.reduce((s, r) => s + r.optionsMarkMarketValue, 0))
                    }
                  >
                    {usd2Masked(scopedRows.reduce((s, r) => s + r.optionsMarkMarketValue, 0), privacy.masked)}
                  </td>
                  <td
                    className={
                      "py-2 pr-4 text-right tabular-nums " +
                      posNegClass(scopedRows.reduce((s, r) => s + netLiquidatingMv(r), 0))
                    }
                  >
                    {usd2Masked(scopedRows.reduce((s, r) => s + netLiquidatingMv(r), 0), privacy.masked)}
                  </td>
                  <td
                    className={
                      "py-2 pr-4 text-right tabular-nums " +
                      posNegClass(scopedRows.reduce((s, r) => s + r.spotMarketValue + r.syntheticMarketValue, 0))
                    }
                  >
                    {usd2Masked(scopedRows.reduce((s, r) => s + r.spotMarketValue + r.syntheticMarketValue, 0), privacy.masked)}
                  </td>
                  <td
                    className={
                      "py-2 pr-4 text-right tabular-nums " +
                      posNegClass(scopedRows.reduce((s, r) => s + (Number.isFinite(r.syntheticShares) ? r.syntheticShares : 0), 0))
                    }
                  >
                    {scopedRows
                      .reduce((s, r) => s + (Number.isFinite(r.syntheticShares) ? r.syntheticShares : 0), 0)
                      .toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td
                    className={
                      "py-2 pr-4 text-right tabular-nums " +
                      posNegClass(scopedRows.reduce((s, r) => s + (r.heldShares ?? 0), 0))
                    }
                  >
                    {scopedRows
                      .reduce((s, r) => s + (r.heldShares ?? 0), 0)
                      .toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td
                    className={
                      "py-2 pr-4 text-right tabular-nums " +
                      posNegClass(
                        scopedRows.reduce((s, r) => s + (r.heldShares ?? 0) + (r.syntheticShares ?? 0), 0),
                      )
                    }
                  >
                    {scopedRows
                      .reduce((s, r) => s + (r.heldShares ?? 0) + (r.syntheticShares ?? 0), 0)
                      .toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">100.00%</td>
                </tr>
              ) : null}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-6 text-center text-zinc-600 dark:text-zinc-400">
                    No data yet. Connect Schwab and run a sync.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="flex flex-col rounded-2xl border border-zinc-300 bg-white p-4 shadow-sm dark:border-white/20 dark:bg-zinc-950 sm:p-6">
        <h2 className="text-base font-semibold">Weighting (pie & bars)</h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Color-coded by symbol. The exposure table and % column always use delta-weighted synthetic MV. Pie and bar charts follow the scope below; when you choose{" "}
          <span className="font-medium text-zinc-800 dark:text-zinc-200">Mark (contracts)</span> (options liquidating value) for charts, slices can diverge from the table while History (if enabled) stays
          delta-based snapshots. Drag the control blocks on the left by their handle to reorder them.
        </p>

        <div className="mt-4 flex min-h-0 w-full min-w-0 flex-1 flex-col gap-3 lg:min-h-[min(28rem,58vh)] lg:flex-row lg:gap-4">
          <DraggableControlColumn
            storageKey="fh.allocation.weightControlsOrder.v1"
            defaultOrder={["scope", "weights", "chartOpts", "selection"]}
            titles={{
              scope: "Scope",
              weights: "Weights",
              chartOpts: "Chart options MV",
              selection: "Current",
            }}
            className="w-full shrink-0 lg:w-[15.5rem]"
            renderBlock={(id) => {
              if (id === "scope") {
                return (
                  <div className="grid w-full max-w-full grid-cols-1 gap-1.5 sm:grid-cols-3">
                    {(
                      [
                        { key: "net", label: "All" },
                        { key: "brokerage", label: "Brokerage" },
                        { key: "retirement", label: "Retirement" },
                      ] as const
                    ).map((v) => (
                      <button
                        key={v.key}
                        type="button"
                        onClick={() => setPieView(v.key)}
                        className={
                          BTN_CLASSES +
                          " min-w-0 shadow-sm " +
                          (pieView === v.key
                            ? "bg-zinc-900 text-white shadow dark:bg-white dark:text-zinc-900"
                            : "border border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900")
                        }
                      >
                        {v.label}
                      </button>
                    ))}
                  </div>
                );
              }
              if (id === "weights") {
                return (
                  <div className="grid w-full max-w-full grid-cols-1 gap-1.5 sm:grid-cols-3">
                    {(["net", "spot", "synthetic"] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setPieMetric(m)}
                        className={
                          BTN_CLASSES +
                          " min-w-0 shadow-sm " +
                          (pieMetric === m
                            ? "bg-zinc-900 text-white shadow dark:bg-white dark:text-zinc-900"
                            : "border border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900")
                        }
                      >
                        {PIE_METRIC_LABEL[m]}
                      </button>
                    ))}
                  </div>
                );
              }
              if (id === "chartOpts") {
                if (pieMetric !== "synthetic" && pieMetric !== "net") {
                  return (
                    <p className="text-xs text-zinc-500 dark:text-zinc-500">
                      Chart MV basis applies when weights are Net or Synthetic.
                    </p>
                  );
                }
                return (
                  <div className="grid w-full max-w-full grid-cols-1 gap-1.5 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => setSyntheticChartBasis("delta")}
                      className={
                        BTN_CLASSES +
                        " min-w-0 shadow-sm " +
                        (syntheticChartBasis === "delta"
                          ? "bg-zinc-900 text-white shadow dark:bg-white dark:text-zinc-900"
                          : "border border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900")
                      }
                    >
                      Δ proxy
                    </button>
                    <button
                      type="button"
                      onClick={() => setSyntheticChartBasis("mark")}
                      className={
                        BTN_CLASSES +
                        " min-w-0 shadow-sm " +
                        (syntheticChartBasis === "mark"
                          ? "bg-zinc-900 text-white shadow dark:bg-white dark:text-zinc-900"
                          : "border border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900")
                      }
                    >
                      Mark (contracts)
                    </button>
                  </div>
                );
              }
              if (id === "selection") {
                return (
                  <div className="text-xs font-medium leading-relaxed text-zinc-700 dark:text-zinc-300">
                    {pieView === "net" ? "All" : pieView === "brokerage" ? "Brokerage" : "Retirement"} · {PIE_METRIC_LABEL[pieMetric]}
                    {pieMetric !== "spot" && syntheticChartBasis === "mark" ? (
                      <span className="mt-1 block text-zinc-500 dark:text-zinc-500">Charts use option contract marks</span>
                    ) : null}
                  </div>
                );
              }
              return null;
            }}
          />

          <div className="flex min-h-[min(22rem,48vh)] w-full min-w-0 flex-1 flex-col overflow-visible rounded-xl border border-zinc-200 bg-white p-2 shadow-sm dark:border-white/15 dark:bg-zinc-950 sm:p-3 lg:min-h-0">
            <FinancePiePanel
              layout="split"
              title={`${pieView === "net" ? "All accounts" : pieView === "retirement" ? "Retirement" : "Brokerage"} · ${pieMetricChartSubtitle(pieMetric)}`}
              symbolColorMap={chartSymbolColors}
              emptyMessage={
                pieMetric === "synthetic" && Math.abs(chartScopedMetricTotal) < 1e-9
                  ? syntheticChartBasis === "mark"
                    ? "No options liquidating value to chart (all slices ≤ $0). Values come from option contract marks on your positions after sync."
                    : "No synthetic market value to chart (all slices ≤ $0). Refresh option greeks on Connections if you hold options — deltas must be loaded for synthetic MV."
                  : undefined
              }
              buckets={[
                {
                  label: pieView,
                  totalMarketValue: chartScopedMetricTotal,
                  byAsset: chartScopedRows.map((r) => {
                    const mv = sliceMv(r, pieMetric);
                    return {
                      key: r.underlyingSymbol.trim(),
                      marketValue: mv,
                      weight: chartScopedMetricTotal ? mv / chartScopedMetricTotal : 0,
                    };
                  }),
                },
              ]}
            />
          </div>
          <div className="flex min-h-[min(22rem,48vh)] w-full min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white p-2 shadow-sm dark:border-white/15 dark:bg-zinc-950 sm:p-3 lg:min-h-0">
            <AllocationWeightingChart
              layout="split"
              pieView={pieView}
              pieMetric={pieMetric}
              scopedRows={chartScopedRows}
              scopedMetricTotal={chartScopedMetricTotal}
              syntheticChartBasis={syntheticChartBasis}
              symbolColorMap={chartSymbolColors}
            />
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-zinc-300 bg-white p-6 shadow-sm dark:border-white/20 dark:bg-zinc-950">
        <h2 className="text-base font-semibold">By asset class</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-zinc-300 text-left text-zinc-600 dark:border-white/20 dark:text-zinc-400">
                <SortTh
                  col="key"
                  label="Class"
                  sortColumn={classSortColumn}
                  sortAsc={classSortAsc}
                  onToggle={toggleClassSort}
                  className="py-2 pr-4 font-medium"
                />
                <SortTh
                  col="mv"
                  label="Market value"
                  sortColumn={classSortColumn}
                  sortAsc={classSortAsc}
                  onToggle={toggleClassSort}
                  className="py-2 pr-4 text-right font-medium"
                />
                <SortTh
                  col="weight"
                  label="Weight"
                  sortColumn={classSortColumn}
                  sortAsc={classSortAsc}
                  onToggle={toggleClassSort}
                  className="py-2 pr-4 text-right font-medium"
                />
              </tr>
            </thead>
            <tbody>
              {sortedAssetClass.map((b) => (
                <tr key={b.key} className="border-b border-zinc-200 dark:border-white/20">
                  <td className="py-2 pr-4 font-medium">{b.key}</td>
                  <td className={"py-2 pr-4 text-right tabular-nums " + posNegClass(b.marketValue)}>
                    {usd2Masked(b.marketValue, privacy.masked)}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">{PCT2.format(b.weight * 100)}%</td>
                </tr>
              ))}
              {assetClass.length === 0 ? (
                <tr>
                  <td colSpan={3} className="py-6 text-center text-zinc-600 dark:text-zinc-400">
                    No allocation data yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-zinc-300 bg-white p-6 shadow-sm dark:border-white/20 dark:bg-zinc-950">
        <h2 className="text-base font-semibold">By account</h2>
        <div className="mt-4 grid gap-4">
          {accounts.map((a) => (
            <details
              key={a.accountId}
              className="rounded-xl border border-zinc-300 p-4 open:bg-zinc-50 dark:border-white/20 dark:open:bg-black/30"
            >
              <summary className="cursor-pointer list-none">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-sm font-semibold">{a.accountName}</div>
                  <div className={"text-sm text-zinc-600 dark:text-zinc-400 " + posNegClass(a.totalMarketValue)}>
                    {usd2Masked(a.totalMarketValue, privacy.masked)}
                  </div>
                </div>
              </summary>
              <div className="mt-3 overflow-x-auto">
                <AccountAssetClassTable rows={a.byAssetClass} masked={privacy.masked} />
              </div>
              <AccountPositionsForAllocation accountId={a.accountId} />
            </details>
          ))}
          {accounts.length === 0 ? (
            <div className="text-sm text-zinc-600 dark:text-zinc-400">No accounts yet.</div>
          ) : null}
        </div>
      </section>
    </div>
  );
}


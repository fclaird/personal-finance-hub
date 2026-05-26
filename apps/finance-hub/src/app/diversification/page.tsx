"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { ExposurePositionTreemap } from "@/app/components/charts/ExposurePositionTreemap";
import { DraggableTileLayout } from "@/app/components/DraggableTileLayout";
import { EditablePageHeading } from "@/app/components/EditableHeading";
import { FinancePiePanel, type PieBucket } from "@/app/components/FinancePiePanel";
import { usePrivacy } from "@/app/components/PrivacyProvider";
import { formatUsd2 } from "@/lib/format";
import { taxonomyForSymbol as demoTaxonomyForSymbol } from "@/lib/demoTaxonomy";
import { assignEarthToneColorsBySymbols } from "@/lib/charts/pieEarthTones";
import { normalizeSectorLabel } from "@/lib/sectorLabel";

type TaxonomyCategory = "sector" | "marketCap" | "revenueGeo";

type TaxonomyRow = {
  sector: string | null;
  industry: string | null;
  marketCap: number | null;
  revenueGeoBucket: string | null;
  source: string | null;
  updatedAt: string;
};

function taxonomyBucket(map: Map<string, TaxonomyRow>, sym: string, category: TaxonomyCategory): string {
  const s = (sym ?? "").trim().toUpperCase();
  if (category === "marketCap") return s;

  const t = map.get(s);
  const fallback = demoTaxonomyForSymbol(s);
  if (!t) return category === "sector" ? normalizeSectorLabel(fallback.sector) : fallback.revenueGeo;
  if (category === "sector") return normalizeSectorLabel(t.sector ?? fallback.sector);
  return t.revenueGeoBucket ?? fallback.revenueGeo;
}

type ExposureRow = {
  underlyingSymbol: string;
  spotMarketValue: number;
  syntheticMarketValue: number;
  syntheticShares: number;
};

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

const PIE_METRIC_LABEL: Record<PieMetric, string> = {
  spot: "Spot",
  synthetic: "Synthetic",
  net: "Net",
};

function usd2Masked(v: number, masked: boolean) {
  return formatUsd2(v, { mask: masked });
}

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

const BTN =
  "flex h-8 min-w-0 shrink-0 items-center justify-center whitespace-nowrap rounded-md px-2.5 text-xs font-semibold tracking-tight";

function controlBtnClass(active: boolean) {
  return (
    BTN +
    " shadow-sm " +
    (active
      ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
      : "border border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900")
  );
}

function ControlGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-1">{children}</div>
    </div>
  );
}

type RolledSlice = {
  key: string;
  mv: number;
  weight: number;
  constituents: Array<{ symbol: string; marketValue: number }>;
};

function buildDiversificationPieData(
  rolledRows: RolledSlice[],
  expanded: ReadonlySet<string>,
): { total: number; byAsset: PieBucket["byAsset"] } {
  const byAsset: PieBucket["byAsset"] = [];
  for (const r of rolledRows) {
    if (expanded.has(r.key)) {
      for (const c of r.constituents) {
        if (c.marketValue <= 0) continue;
        byAsset.push({
          key: c.symbol,
          marketValue: c.marketValue,
          weight: 0,
          constituents: [],
        });
      }
    } else {
      byAsset.push({
        key: r.key,
        marketValue: r.mv,
        weight: 0,
        constituents: r.constituents,
      });
    }
  }
  const total = byAsset.reduce((s, x) => s + x.marketValue, 0);
  for (const x of byAsset) x.weight = total ? x.marketValue / total : 0;
  byAsset.sort((a, b) => b.marketValue - a.marketValue || a.key.localeCompare(b.key));
  return { total, byAsset };
}

function rollupCategory(
  rows: ExposureRow[],
  category: TaxonomyCategory,
  metric: PieMetric,
  tax: Map<string, TaxonomyRow>,
): { total: number; rows: RolledSlice[] } {
  const m = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const mv = sliceMv(r, metric);
    if (mv === 0) continue;
    const k = taxonomyBucket(tax, r.underlyingSymbol, category);
    const sym = r.underlyingSymbol.trim().toUpperCase();
    const inner = m.get(k) ?? new Map<string, number>();
    inner.set(sym, (inner.get(sym) ?? 0) + mv);
    m.set(k, inner);
  }
  const total = Array.from(m.values()).reduce(
    (acc, inner) => acc + Array.from(inner.values()).reduce((a, b) => a + b, 0),
    0,
  );
  const rowsOut = Array.from(m.entries())
    .map(([key, inner]) => {
      const mv = Array.from(inner.values()).reduce((a, b) => a + b, 0);
      const constituents = Array.from(inner.entries())
        .map(([symbol, marketValue]) => ({ symbol, marketValue }))
        .filter((c) => c.marketValue > 0)
        .sort((a, b) => b.marketValue - a.marketValue || a.symbol.localeCompare(b.symbol));
      return { key, mv, weight: total ? mv / total : 0, constituents };
    })
    .sort((a, b) => b.mv - a.mv || a.key.localeCompare(b.key));
  return { total, rows: rowsOut };
}

export default function DiversificationPage() {
  const privacy = usePrivacy();
  const [rows, setRows] = useState<ExposureRow[]>([]);
  const [exposureBuckets, setExposureBuckets] = useState<
    Array<{ bucketKey: "brokerage" | "retirement" | "529"; exposure: ExposureRow[] }>
  >([]);
  const [tax, setTax] = useState<Map<string, TaxonomyRow>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<TaxonomyCategory>("sector");
  const [pieView, setPieView] = useState<"net" | "retirement" | "brokerage" | "529">("net");
  const [pieMetric, setPieMetric] = useState<PieMetric>("net");
  const [expandedSectorKeys, setExpandedSectorKeys] = useState<string[]>([]);

  useEffect(() => {
    void (async () => {
      setError(null);
      try {
        const expResp = await fetch("/api/exposure", { cache: "no-store" });
        async function safeJson(resp: Response) {
          const text = await resp.text();
          try {
            return JSON.parse(text) as unknown;
          } catch {
            const url = resp.url || "(unknown url)";
            throw new Error(`Non-JSON response (${resp.status}) from ${url}: ${text ? text.slice(0, 300) : "(empty body)"}`);
          }
        }
        const expJson = (await safeJson(expResp)) as {
          ok: boolean;
          exposure?: ExposureRow[];
          buckets?: Array<{ bucketKey: "brokerage" | "retirement" | "529"; exposure: ExposureRow[] }>;
          error?: string;
        };
        if (!expJson.ok) throw new Error(expJson.error ?? "Failed to load exposure");
        const exposure = expJson.exposure ?? [];
        setRows(exposure);
        setExposureBuckets(expJson.buckets ?? []);

        const syms = Array.from(new Set(exposure.map((r) => r.underlyingSymbol).filter(Boolean)));
        if (syms.length) {
          void (async () => {
            try {
              await fetch("/api/taxonomy/sync", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ symbols: syms }),
              });
              const txResp = await fetch(`/api/taxonomy?symbols=${encodeURIComponent(syms.join(","))}`, { cache: "no-store" });
              const txJson = (await txResp.json()) as { ok: boolean; taxonomy?: Record<string, TaxonomyRow> };
              const m = new Map<string, TaxonomyRow>();
              for (const [k, v] of Object.entries(txJson.taxonomy ?? {})) m.set(k.toUpperCase(), v as TaxonomyRow);
              setTax(m);
            } catch {
              // taxonomy is optional for first paint
            }
          })();
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  const scopedRows = useMemo(() => {
    if (pieView === "net") return rows;
    const b = exposureBuckets.find((x) => x.bucketKey === pieView);
    return b?.exposure ?? [];
  }, [rows, exposureBuckets, pieView]);

  const rolled = useMemo(() => rollupCategory(scopedRows, category, pieMetric, tax), [scopedRows, category, pieMetric, tax]);

  const expandedSectorSet = useMemo(() => new Set(expandedSectorKeys.map((k) => k.trim()).filter(Boolean)), [expandedSectorKeys]);

  const pieFromRollup = useMemo(
    () => buildDiversificationPieData(rolled.rows, expandedSectorSet),
    [rolled.rows, expandedSectorSet],
  );

  const pieSymbolColors = useMemo(() => {
    const syms = pieFromRollup.byAsset.map((x) => x.key.trim().toUpperCase()).filter(Boolean);
    return assignEarthToneColorsBySymbols(syms);
  }, [pieFromRollup.byAsset]);

  const onToggleSliceExpand = (sliceKey: string) => {
    const k = sliceKey.trim();
    if (!k) return;
    setExpandedSectorKeys((prev) => {
      const s = new Set(prev.map((x) => x.trim()).filter(Boolean));
      if (s.has(k)) s.delete(k);
      else s.add(k);
      return [...s];
    });
  };

  useEffect(() => {
    setExpandedSectorKeys([]);
  }, [category, pieView, pieMetric]);

  const pieTotal = pieFromRollup.total;

  const capBySymbol = useMemo(() => {
    const m = new Map<string, number | null>();
    for (const [sym, row] of tax) m.set(sym, row.marketCap ?? null);
    return m;
  }, [tax]);

  useEffect(() => {
    if (category !== "marketCap") return;
    const syms = Array.from(
      new Set(scopedRows.map((r) => r.underlyingSymbol.trim().toUpperCase()).filter(Boolean)),
    );
    if (syms.length === 0) return;
    let cancelled = false;
    void (async () => {
      try {
        await fetch("/api/taxonomy/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbols: syms, refreshMarketCapsFromSchwab: true }),
        });
        const txResp = await fetch(`/api/taxonomy?symbols=${encodeURIComponent(syms.join(","))}`, { cache: "no-store" });
        const txJson = (await txResp.json()) as { ok: boolean; taxonomy?: Record<string, TaxonomyRow> };
        if (cancelled) return;
        setTax((prev) => {
          const next = new Map(prev);
          for (const [k, v] of Object.entries(txJson.taxonomy ?? {})) {
            next.set(k.toUpperCase(), v as TaxonomyRow);
          }
          return next;
        });
      } catch {
        /* Schwab / taxonomy optional */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [category, scopedRows, pieView, pieMetric]);

  const categoryTitle =
    category === "sector" ? "Sector" : category === "marketCap" ? "Market cap" : "Revenue geography";

  const scopeTitle =
    pieView === "net" ? "Net" : pieView === "brokerage" ? "Brokerage" : pieView === "529" ? "529" : "Retirement";

  const chartTitle = `${scopeTitle} · ${categoryTitle} · ${pieMetricChartSubtitle(pieMetric)}`;

  const pieControlBanner = (
    <div className="flex flex-wrap items-end justify-between gap-x-5 gap-y-2 border-b border-zinc-200 pb-3 dark:border-white/10">
      <div className="flex min-w-0 flex-wrap items-end gap-x-5 gap-y-2">
        <ControlGroup label="Category">
          {(
            [
              { key: "sector", label: "Sector" },
              { key: "marketCap", label: "Market cap" },
              { key: "revenueGeo", label: "Revenue geo" },
            ] as const
          ).map((c) => (
            <button key={c.key} type="button" onClick={() => setCategory(c.key)} className={controlBtnClass(category === c.key)}>
              {c.label}
            </button>
          ))}
        </ControlGroup>
        <ControlGroup label="Scope">
          {(
            [
              { key: "net", label: "Net" },
              { key: "brokerage", label: "Brokerage" },
              { key: "retirement", label: "Retirement" },
              { key: "529", label: "529" },
            ] as const
          ).map((v) => (
            <button key={v.key} type="button" onClick={() => setPieView(v.key)} className={controlBtnClass(pieView === v.key)}>
              {v.label}
            </button>
          ))}
        </ControlGroup>
        <ControlGroup label="Weights">
          {(["net", "spot", "synthetic"] as const).map((m) => (
            <button key={m} type="button" onClick={() => setPieMetric(m)} className={controlBtnClass(pieMetric === m)}>
              {PIE_METRIC_LABEL[m]}
            </button>
          ))}
        </ControlGroup>
      </div>
      {expandedSectorKeys.length ? (
        <p className="shrink-0 text-xs text-zinc-600 dark:text-zinc-400">
          {expandedSectorKeys.length} slice{expandedSectorKeys.length === 1 ? "" : "s"} broken out
        </p>
      ) : null}
    </div>
  );

  return (
    <div className="flex w-full max-w-[108rem] flex-1 flex-col gap-8 py-10 pl-5 pr-6 sm:pl-6 sm:pr-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            <EditablePageHeading pageId="diversification" defaultTitle="Diversification" />
          </h1>
          <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Sector / market cap / revenue geography with the same account and pie-weight controls as Allocation.
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

      <DraggableTileLayout
        storageKey="fh.diversification.tiles.v1"
        defaultOrder={["overview", "chart"]}
        tiles={{
          overview: {
            title: "Diversification mix",
            children: (
              <>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Category, scope, and weight controls sit in a compact banner above the chart. Pie slice labels are editable on click; use the chart tooltip to break a slice into individual holdings.
        </p>
        {error ? (
          <div className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950/30 dark:text-red-200">
            {error}
          </div>
        ) : null}
              </>
            ),
          },
          chart: {
            title: chartTitle,
            bodyClassName: "p-4",
            children: (
          <div className="flex min-w-0 flex-col gap-3">
            {pieControlBanner}
            {category === "marketCap" ? (
              <ExposurePositionTreemap
                leaves={rolled.rows.flatMap((r) => r.constituents)}
                underlyingMarketCapBySymbol={capBySymbol}
                masked={privacy.masked}
                title={chartTitle}
              />
            ) : (
              <FinancePiePanel
                title={chartTitle}
                symbolColorMap={pieSymbolColors}
                allowLabelEdit
                labelStorageKey={`diversification-${category}`}
                expandedSliceKeys={expandedSectorKeys}
                onToggleSliceExpand={onToggleSliceExpand}
                enableSliceBreakout
                buckets={[
                  {
                    label: "tax",
                    totalMarketValue: pieTotal,
                    byAsset: pieFromRollup.byAsset,
                  },
                ]}
              />
            )}
          </div>
            ),
          },
        }}
      />
    </div>
  );
}

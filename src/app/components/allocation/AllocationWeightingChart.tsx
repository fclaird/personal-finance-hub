"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { usePrivacy } from "@/app/components/PrivacyProvider";
import { assignEarthToneColorsBySymbols, distinctColorForIndex } from "@/lib/charts/pieEarthTones";
import { formatUsd2 } from "@/lib/format";
import { symbolPageHref } from "@/lib/symbolPage";

const PCT2 = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const BTN =
  "flex h-8 min-w-[5.5rem] items-center justify-center whitespace-nowrap rounded-md px-2 text-xs font-semibold tracking-tight";

export type AllocationChartExposureRow = {
  underlyingSymbol: string;
  spotMarketValue: number;
  heldShares: number;
  syntheticMarketValue: number;
  syntheticShares: number;
  /** Carried for typing parity with `/api/exposure`; bar/pie use `syntheticMarketValue` from the parent (Δ proxy or options liquidating value). */
  optionsMarkMarketValue?: number;
};

export type AllocationChartPieMetric = "spot" | "synthetic" | "net";
export type AllocationChartPieView = "net" | "brokerage" | "retirement";

type BarRow = { id: string; label: string; marketValue: number; pct: number; fill: string };

function normalizeAxisLabel(s: string): string {
  return s.replace(/\u2013|\u2014/g, "—").trim();
}

/** Match Y-axis tick text to a bar row (handles dash variants and synthetic rows). */
function barRowForYAxisLabel(rows: BarRow[], axisLabel: string): BarRow | undefined {
  const n = normalizeAxisLabel(axisLabel);
  const byExact = rows.find((row) => normalizeAxisLabel(row.label) === n);
  if (byExact) return byExact;
  const m = n.match(/^(.+?)\s*—\s*Synthetic$/i);
  if (m) {
    const base = m[1]!.trim();
    return rows.find((row) => underlyingKeyFromBarId(row.id) === base);
  }
  return undefined;
}

function underlyingTickerFromBarLabel(label: string): string | null {
  const n = normalizeAxisLabel(label);
  const m = n.match(/^(.+?)\s*—\s*Synthetic$/i);
  const raw = (m ? m[1]! : n).trim().toUpperCase();
  return raw || null;
}
function underlyingKeyFromBarId(id: string): string {
  if (id.endsWith("-spot")) return id.slice(0, -"-spot".length);
  if (id.endsWith("-synth")) return id.slice(0, -"-synth".length);
  return id;
}

function pctAxisStep(maxAbs: number): number {
  if (maxAbs <= 12) return 2;
  if (maxAbs <= 50) return 5;
  if (maxAbs <= 100) return 10;
  return 20;
}

/** Percent axis bounds from data min/max with padding and rounded tick-friendly limits. */
function pctDomainFromMinMax(
  minV: number,
  maxV: number,
  opts?: { tight?: boolean },
): [number, number] {
  const span = maxV - minV;
  const pad = opts?.tight
    ? Math.max(0.2, span * 0.05, Math.abs(maxV) * 0.02)
    : Math.max(0.35, span * 0.08, Math.abs(maxV) * 0.04);
  let lo = minV < 0 ? minV - pad : Math.max(0, minV - pad * 0.25);
  let hi = maxV + pad;
  const step = pctAxisStep(Math.max(Math.abs(lo), Math.abs(hi)));
  hi = Math.ceil(hi / step) * step;
  if (minV < 0) lo = Math.floor(lo / step) * step;
  else lo = 0;
  if (hi <= lo) return [Math.min(lo, 0), Math.max(hi, step)];
  return [lo, hi];
}

function buildBarRows(
  scopedRows: AllocationChartExposureRow[],
  pieMetric: AllocationChartPieMetric,
  scopedMetricTotal: number,
  symbolColorMap?: Map<string, string>,
): BarRow[] {
  if (pieMetric === "net") {
    const netTotal =
      scopedRows.reduce((s, r) => s + r.spotMarketValue + r.syntheticMarketValue, 0) || scopedMetricTotal;
    const raw: Array<{ id: string; label: string; marketValue: number }> = [];
    for (const r of scopedRows) {
      const sym = r.underlyingSymbol.trim();
      if (r.spotMarketValue > 1e-9) {
        raw.push({ id: `${sym}-spot`, label: sym, marketValue: r.spotMarketValue });
      }
      if (Math.abs(r.syntheticMarketValue) > 1e-9) {
        raw.push({ id: `${sym}-synth`, label: `${sym} — Synthetic`, marketValue: r.syntheticMarketValue });
      }
    }
    raw.sort((a, b) => b.marketValue - a.marketValue || a.label.localeCompare(b.label));
    const seen = new Set<string>();
    const underlyingOrder: string[] = [];
    for (const row of raw) {
      const k = underlyingKeyFromBarId(row.id);
      if (!seen.has(k)) {
        seen.add(k);
        underlyingOrder.push(k);
      }
    }
    const colorByUnderlying = symbolColorMap ?? assignEarthToneColorsBySymbols(underlyingOrder);
    return raw.map((row) => ({
      ...row,
      pct: netTotal > 1e-9 ? (row.marketValue / netTotal) * 100 : 0,
      fill: colorByUnderlying.get(underlyingKeyFromBarId(row.id)) ?? distinctColorForIndex(0),
    }));
  }

  const metricTotal =
    pieMetric === "spot"
      ? scopedRows.reduce((s, r) => s + r.spotMarketValue, 0)
      : scopedRows.reduce((s, r) => s + r.syntheticMarketValue, 0);
  const denom = Math.abs(metricTotal) > 1e-9 ? metricTotal : scopedMetricTotal;

  const raw = scopedRows
    .map((r) => ({
      id: r.underlyingSymbol.trim(),
      label: r.underlyingSymbol.trim(),
      marketValue: pieMetric === "spot" ? r.spotMarketValue : r.syntheticMarketValue,
    }))
    .filter((x) =>
      pieMetric === "spot" ? x.marketValue > 1e-9 : Math.abs(x.marketValue) > 1e-9,
    )
    .sort((a, b) => b.marketValue - a.marketValue || a.label.localeCompare(b.label));

  const labels = raw.map((r) => r.label);
  const colorByLabel = symbolColorMap ?? assignEarthToneColorsBySymbols(labels);

  return raw.map((row) => ({
    ...row,
    pct: Math.abs(denom) > 1e-9 ? (row.marketValue / denom) * 100 : 0,
    fill: colorByLabel.get(row.label.trim()) ?? distinctColorForIndex(0),
  }));
}

type HistoryApi = {
  ok: boolean;
  dates?: string[];
  series?: Array<{ symbol: string; points: Array<{ date: string; pct: number }> }>;
  error?: string;
};

export function AllocationWeightingChart({
  pieView,
  pieMetric,
  scopedRows,
  scopedMetricTotal,
  syntheticChartBasis = "delta",
  symbolColorMap,
  layout = "default",
}: {
  pieView: AllocationChartPieView;
  pieMetric: AllocationChartPieMetric;
  scopedRows: AllocationChartExposureRow[];
  scopedMetricTotal: number;
  /** When `mark`, daily history is still delta-proxy; History is disabled to avoid mixing bases. */
  syntheticChartBasis?: "delta" | "mark";
  /** Shared with `FinancePiePanel` so bar (and history line) colors match pie slices per underlying. */
  symbolColorMap?: Map<string, string>;
  /** `split`: sit beside pie in allocation; tighter chrome and height tuned for the two-column tile. */
  layout?: "default" | "split";
}) {
  const router = useRouter();
  const privacy = usePrivacy();
  const split = layout === "split";
  const [view, setView] = useState<"line" | "bars">("bars");
  const [loading, setLoading] = useState(false);
  const [histError, setHistError] = useState<string | null>(null);
  const [dates, setDates] = useState<string[]>([]);
  const [series, setSeries] = useState<HistoryApi["series"]>([]);

  const historyUsesDeltaProxyOnly =
    syntheticChartBasis === "mark" && (pieMetric === "synthetic" || pieMetric === "net");

  useEffect(() => {
    if (historyUsesDeltaProxyOnly && view === "line") setView("bars");
  }, [historyUsesDeltaProxyOnly, view]);

  useEffect(() => {
    if (view !== "line") return;
    let cancelled = false;
    const url = `/api/allocation/underlying-history?days=365&bucket=${encodeURIComponent(pieView)}&metric=${encodeURIComponent(pieMetric)}`;
    void Promise.resolve().then(async () => {
      if (cancelled) return;
      setLoading(true);
      setHistError(null);
      try {
        const resp = await fetch(url, { credentials: "include", cache: "no-store" });
        const json = (await resp.json()) as HistoryApi;
        if (cancelled) return;
        if (!json.ok) {
          setHistError(json.error ?? "Failed to load history");
          setDates([]);
          setSeries([]);
        } else {
          setDates(json.dates ?? []);
          setSeries(json.series ?? []);
        }
      } catch (e) {
        if (!cancelled) setHistError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [view, pieView, pieMetric]);

  const lineChartData = useMemo(() => {
    if (!dates.length || !series?.length) return [];
    return dates.map((date, di) => {
      const row: Record<string, string | number> = { date };
      for (const s of series) {
        const pt = s.points[di];
        row[s.symbol] = pt ? pt.pct : 0;
      }
      return row;
    });
  }, [dates, series]);

  const barRows = useMemo(
    () => buildBarRows(scopedRows, pieMetric, scopedMetricTotal, symbolColorMap),
    [scopedRows, pieMetric, scopedMetricTotal, symbolColorMap],
  );

  /** Descending weight: largest bar at top (Recharts maps first row to top of category axis). */
  const barDataSorted = useMemo(() => {
    return [...barRows].sort((a, b) => b.pct - a.pct || a.label.localeCompare(b.label));
  }, [barRows]);

  const lineStrokeBySymbol = useMemo(() => {
    if (!series?.length) return new Map<string, string>();
    if (symbolColorMap?.size) {
      const m = new Map<string, string>();
      const missing: string[] = [];
      for (const s of series) {
        const sym = (s.symbol ?? "").trim();
        const c = symbolColorMap.get(sym);
        if (c) m.set(s.symbol, c);
        else missing.push(sym);
      }
      if (missing.length) {
        const fallback = assignEarthToneColorsBySymbols(missing);
        for (const s of series) {
          if (m.has(s.symbol)) continue;
          const sym = (s.symbol ?? "").trim();
          m.set(s.symbol, fallback.get(sym) ?? distinctColorForIndex(0));
        }
      }
      return m;
    }
    return assignEarthToneColorsBySymbols(series.map((s) => s.symbol));
  }, [series, symbolColorMap]);

  /** X-axis from data (largest bar ≈ axis max), not fixed 0–100%. */
  const barPctDomain = useMemo((): [number, number] => {
    if (!barDataSorted.length) return [0, 100];
    let minV = barDataSorted[0]!.pct;
    let maxV = barDataSorted[0]!.pct;
    for (let i = 1; i < barDataSorted.length; i++) {
      const p = barDataSorted[i]!.pct;
      minV = Math.min(minV, p);
      maxV = Math.max(maxV, p);
    }
    return pctDomainFromMinMax(minV, maxV);
  }, [barDataSorted]);

  /** Y-axis from visible history series, not fixed 0–100%. */
  const linePctDomain = useMemo((): [number, number] => {
    if (!lineChartData.length) return [0, 100];
    let minV = Infinity;
    let maxV = -Infinity;
    for (const row of lineChartData) {
      for (const [key, val] of Object.entries(row)) {
        if (key === "date") continue;
        const n = typeof val === "number" ? val : Number(val);
        if (!Number.isFinite(n)) continue;
        minV = Math.min(minV, n);
        maxV = Math.max(maxV, n);
      }
    }
    if (!Number.isFinite(minV) || !Number.isFinite(maxV)) return [0, 100];
    return pctDomainFromMinMax(minV, maxV, { tight: true });
  }, [lineChartData]);

  return (
    <div className={split ? "mt-0 flex h-full min-h-0 w-full min-w-0 flex-col" : "mt-4 w-full min-w-0"}>
      <div className={split ? "mb-2 flex flex-wrap items-center gap-2" : "mb-3 flex flex-wrap items-center gap-2"}>
        <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">Chart</span>
        <div className="grid w-max grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={() => setView("bars")}
            className={
              BTN +
              (view === "bars"
                ? " bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
                : " border border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900")
            }
          >
            Bars (current)
          </button>
          <button
            type="button"
            disabled={historyUsesDeltaProxyOnly}
            title={
              historyUsesDeltaProxyOnly
                ? "History replays daily Δ-proxy synthetic weights only. Use Δ proxy for charts to compare, or stay on Bars for options liquidating value."
                : undefined
            }
            onClick={() => setView("line")}
            className={
              BTN +
              (view === "line"
                ? " bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
                : " border border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900") +
              (historyUsesDeltaProxyOnly ? " cursor-not-allowed opacity-45 hover:bg-white dark:hover:bg-zinc-950" : "")
            }
          >
            History
          </button>
        </div>
      </div>

      {view === "line" ? (
        <div
          className={
            split
              ? "flex w-full min-w-0 flex-1 flex-col rounded-lg border border-zinc-300 p-2 dark:border-white/20 sm:p-3 min-h-[min(18rem,42vh)]"
              : "w-full min-w-0 rounded-xl border border-zinc-300 p-3 dark:border-white/20 sm:p-4"
          }
        >
          {loading ? (
            <div className="flex h-[22rem] items-center justify-center text-sm text-zinc-500">Loading history…</div>
          ) : histError ? (
            <div className="flex h-[22rem] flex-col items-center justify-center gap-2 px-4 text-center text-sm text-red-700 dark:text-red-300">
              {histError}
            </div>
          ) : lineChartData.length === 0 ? (
            <div className="flex h-[22rem] flex-col items-center justify-center gap-2 px-4 text-center text-sm text-zinc-600 dark:text-zinc-400">
              No daily snapshots yet. After Schwab sync, weights are recorded for the NY session. You can also POST{" "}
              <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">/api/internal/allocation-daily-close</code>{" "}
              (cron secret) to backfill.
            </div>
          ) : (
            <div className="h-[min(24rem,70vh)] w-full min-h-[18rem]">
              <ResponsiveContainer width="100%" height="100%" minHeight={280}>
                <LineChart data={lineChartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-zinc-200 dark:stroke-zinc-700" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={24} />
                  <YAxis domain={linePctDomain} tickFormatter={(v) => `${v}%`} width={44} tick={{ fontSize: 11 }} />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      return (
                        <div className="max-w-xs rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs shadow-md dark:border-white/20 dark:bg-zinc-900">
                          <div className="font-semibold text-zinc-900 dark:text-zinc-100">{String(label)}</div>
                          <ul className="mt-1 max-h-48 space-y-0.5 overflow-y-auto">
                            {payload
                              .filter((p) => typeof p.value === "number" && Math.abs(p.value as number) > 0.02)
                              .sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0))
                              .map((p) => {
                                const key = String(p.dataKey ?? "");
                                const stroke = lineStrokeBySymbol.get(key);
                                return (
                                  <li key={key} className="flex justify-between gap-4 tabular-nums">
                                    <span
                                      className="font-medium"
                                      style={stroke ? { color: stroke } : undefined}
                                    >
                                      {p.name}
                                    </span>
                                    <span>{PCT2.format(Number(p.value))}%</span>
                                  </li>
                                );
                              })}
                          </ul>
                        </div>
                      );
                    }}
                  />
                  {series?.map((s) => (
                    <Line
                      key={s.symbol}
                      type="monotone"
                      dataKey={s.symbol}
                      name={s.symbol}
                      stroke={lineStrokeBySymbol.get(s.symbol) ?? distinctColorForIndex(0)}
                      strokeWidth={1.75}
                      dot={false}
                      isAnimationActive={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      ) : (
        <div
          className={
            split
              ? "flex min-h-0 w-full min-w-0 flex-1 flex-col bg-transparent p-0"
              : "w-full min-w-0 rounded-xl border border-zinc-300 bg-white p-4 dark:border-white/20 dark:bg-neutral-950 sm:p-5"
          }
        >
          {barDataSorted.length === 0 ? (
            <div className={split ? "py-10 text-center text-sm text-zinc-600 dark:text-zinc-400" : "py-16 text-center text-sm text-zinc-600 dark:text-zinc-400"}>
              No positions to chart.
            </div>
          ) : (
            <div
              className="w-full min-w-0 flex-1"
              style={{
                height: split ? Math.max(280, 52 + barDataSorted.length * 40) : Math.max(440, 88 + barDataSorted.length * 44),
              }}
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  layout="vertical"
                  data={barDataSorted}
                  margin={
                    split
                      ? { top: 6, right: 78, left: 2, bottom: 10 }
                      : { top: 12, right: 72, left: 8, bottom: 16 }
                  }
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} className="stroke-zinc-200 dark:stroke-zinc-700" />
                  <XAxis
                    type="number"
                    domain={barPctDomain}
                    tick={(tickProps) => {
                      const tp = tickProps as { x?: string | number; y?: string | number; payload?: { value?: number } };
                      const x = Number(tp.x ?? 0);
                      const y = Number(tp.y ?? 0);
                      const v = tp.payload?.value;
                      const num = typeof v === "number" ? v : Number(v);
                      const text = Number.isFinite(num) ? `${PCT2.format(num)}%` : "";
                      return (
                        <text
                          x={x}
                          y={y}
                          dy={16}
                          textAnchor="middle"
                          className="fill-[#0a0a0a] text-[13px] font-bold tabular-nums dark:fill-white"
                        >
                          {text}
                        </text>
                      );
                    }}
                  />
                  <YAxis
                    type="category"
                    dataKey="label"
                    width={split ? 172 : 200}
                    interval={0}
                    tick={(tickProps) => {
                      const tp = tickProps as { x?: string | number; y?: string | number; payload?: { value?: string } };
                      const x = Number(tp.x ?? 0);
                      const y = Number(tp.y ?? 0);
                      const label = tp.payload?.value ?? "";
                      const row = barRowForYAxisLabel(barDataSorted, label);
                      const fill = row?.fill ?? "#a1a1aa";
                      const href = (() => {
                        const sym = underlyingTickerFromBarLabel(label);
                        return sym ? symbolPageHref(sym) : null;
                      })();
                      return (
                        <text
                          x={x}
                          y={y}
                          dy={6}
                          textAnchor="end"
                          fill={fill}
                          fontSize={16}
                          fontWeight={800}
                          style={{ cursor: href ? "pointer" : "default" }}
                          onClick={
                            href
                              ? (e) => {
                                  e.preventDefault();
                                  router.push(href);
                                }
                              : undefined
                          }
                        >
                          {href ? <title>Open in Terminal</title> : null}
                          {label}
                        </text>
                      );
                    }}
                  />
                  {barPctDomain[0] < 0 && barPctDomain[1] > 0 ? (
                    <ReferenceLine x={0} stroke="currentColor" className="text-zinc-400 dark:text-zinc-600" strokeDasharray="4 3" />
                  ) : null}
                  <Tooltip
                    formatter={(value, _name, item) => {
                      const v = typeof value === "number" ? value : Number(value);
                      const mv = (item?.payload as BarRow | undefined)?.marketValue;
                      return [
                        `${PCT2.format(v)}%` + (mv != null ? ` · ${formatUsd2(mv, { mask: privacy.masked })}` : ""),
                        "% of total",
                      ];
                    }}
                  />
                  <Bar dataKey="pct" radius={[0, 3, 3, 0]} isAnimationActive={false}>
                    <LabelList
                      dataKey="pct"
                      position="right"
                      content={(labelProps) => {
                        const p = labelProps as {
                          x?: string | number;
                          y?: string | number;
                          width?: string | number;
                          height?: string | number;
                          index?: number;
                          value?: string | number | null;
                        };
                        const { x, y, width, height, index, value } = p;
                        const i = typeof index === "number" ? index : 0;
                        const entry = barDataSorted[i];
                        const fill = entry?.fill ?? "#a1a1aa";
                        const n = value == null ? Number.NaN : typeof value === "number" ? value : Number(value);
                        const text = Number.isFinite(n) ? `${PCT2.format(n)}%` : "";
                        const xi = Number(x ?? 0) + Number(width ?? 0) + 6;
                        const yi = Number(y ?? 0) + Number(height ?? 0) / 2;
                        return (
                          <text
                            x={xi}
                            y={yi}
                            dy="0.35em"
                            fill={fill}
                            fontSize={split ? 16 : 13}
                            fontWeight={split ? 800 : 700}
                          >
                            {text}
                          </text>
                        );
                      }}
                    />
                    {barDataSorted.map((entry, idx) => (
                      <Cell key={entry.id} fill={entry.fill ?? distinctColorForIndex(idx)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

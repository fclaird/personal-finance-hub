"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { DraggableTileLayout } from "@/app/components/DraggableTileLayout";
import { EditablePageHeading } from "@/app/components/EditableHeading";
import { InternalPerformancePanel, type InternalChartRow, type InternalSymbol } from "@/app/performance/InternalPerformancePanel";
import { filletLinearCurve } from "@/lib/charts/curveFilletLinear";
import { formatDisplayDate } from "@/lib/formatDate";
import {
  PERFORMANCE_BENCHMARKS,
  PORTFOLIO_LINE_COLOR,
  type PerformanceBenchmarkId,
} from "@/lib/market/performanceBenchmarks";

const BENCHMARK_PREF_KEY = "fh.performance.benchmarks.v1";
const INTERNAL_METHOD_KEY = "fh.performance.internalMethod.v1";

const INTERNAL_METHODS = [
  {
    id: "capital",
    label: "Capital",
    hint: "Profit divided by the money at risk: shares at the starting price, short-put collateral, long-call premium, and later buys.",
  },
  {
    id: "twr",
    label: "Time-weighted",
    hint: "Daily returns chained together, with each buy or sell removed so new cash does not count as a gain.",
  },
  {
    id: "dietz",
    label: "Modified Dietz",
    hint: "One return for the whole window that gives more weight to cash invested for longer.",
  },
  {
    id: "exposure",
    label: "Exposure",
    hint: "Profit divided by average daily share exposure, priced at the starting stock price, using option delta when it is on file.",
  },
] as const;

type InternalMethod = (typeof INTERNAL_METHODS)[number]["id"];

function parseInternalMethod(value: string | null): InternalMethod | null {
  return INTERNAL_METHODS.some((method) => method.id === value) ? (value as InternalMethod) : null;
}

function readInternalMethod(): InternalMethod {
  if (typeof window === "undefined") return "capital";
  const fromUrl = parseInternalMethod(new URLSearchParams(window.location.search).get("method"));
  if (fromUrl) return fromUrl;
  try {
    return parseInternalMethod(window.localStorage.getItem(INTERNAL_METHOD_KEY)) ?? "capital";
  } catch {
    return "capital";
  }
}

const methodListeners = new Set<() => void>();

function subscribeInternalMethod(listener: () => void) {
  methodListeners.add(listener);
  window.addEventListener("popstate", listener);
  return () => {
    methodListeners.delete(listener);
    window.removeEventListener("popstate", listener);
  };
}

function publishInternalMethod(method: InternalMethod) {
  try {
    window.localStorage.setItem(INTERNAL_METHOD_KEY, method);
  } catch {
    /* ignore private mode */
  }
  const url = new URL(window.location.href);
  url.searchParams.set("method", method);
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  for (const listener of methodListeners) listener();
}

type HistoryChartRow = {
  date: string;
  seq_index: number;
  portfolio: number;
  spy: number | null;
  qqq: number | null;
  iwm?: number | null;
  wti?: number | null;
  btc?: number | null;
  eth?: number | null;
};

type HistoryPayload = {
  ok: boolean;
  chart_data?: HistoryChartRow[];
  meta?: {
    source_mix?: string;
    tracking_start?: string | null;
    tracking_reset_forward?: boolean;
    portfolio_source?: string;
    lookback_days?: number;
    benchmark_spy_rows?: number;
    benchmark_qqq_rows?: number;
  };
  total_return_pct?: number | null;
  vs_spy?: number | null;
  vs_qqq?: number | null;
  error?: string;
};

type PerformanceView = "history" | "internal";

type InternalPayload = {
  ok: boolean;
  symbols?: InternalSymbol[];
  chart_data?: InternalChartRow[];
  error?: string;
};

type ChartRow = {
  asOf: string;
  asOfLabel: string;
  seqIndex: number;
  Portfolio: number;
  spy: number | null;
  qqq: number | null;
  iwm: number | null;
  wti: number | null;
  btc: number | null;
  eth: number | null;
};

function storedBenchmarkIds(): PerformanceBenchmarkId[] | null {
  try {
    const raw = window.localStorage.getItem(BENCHMARK_PREF_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    const allowed = new Set<string>(PERFORMANCE_BENCHMARKS.map((b) => b.id));
    return parsed.filter((id): id is PerformanceBenchmarkId => typeof id === "string" && allowed.has(id));
  } catch {
    return null;
  }
}

function formatPct(v: number) {
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}%`;
}

function trackingStartMs(iso: string | null | undefined): number {
  if (!iso) return Date.now();
  const [y, m, day] = iso.split("-").map(Number);
  if (!y || !m || !day) return Date.now();
  return new Date(y, m - 1, day).getTime();
}

function formatTrackingElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, "0");

  if (days > 0) return `${days}d ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

function TrackingDurationClock({ startIso }: { startIso: string | null | undefined }) {
  const [elapsed, setElapsed] = useState<string | null>(null);

  useEffect(() => {
    const startMs = trackingStartMs(startIso);
    const tick = () => setElapsed(formatTrackingElapsed(Date.now() - startMs));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [startIso]);

  return (
    <div
      className="shrink-0 text-right"
      aria-live="polite"
      aria-label={elapsed ? `Performance tracked for ${elapsed}` : "Performance tracking duration loading"}
    >
      <div className="text-[10px] font-semibold uppercase tracking-wide text-teal-700 dark:text-teal-300/90">
        Tracked
      </div>
      <div className="mt-0.5 min-w-[7.5rem] font-mono text-lg font-semibold tabular-nums tracking-tight text-teal-950 dark:text-teal-50">
        {elapsed ?? "00:00:00"}
      </div>
    </div>
  );
}

async function safeJson(resp: Response) {
  const text = await resp.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    const url = resp.url || "(unknown url)";
    throw new Error(`Non-JSON response (${resp.status}) from ${url}: ${text ? text.slice(0, 200) : "(empty body)"}`);
  }
}

export default function PerformancePage() {
  const [bucket, setBucket] = useState<"combined" | "retirement" | "brokerage">("combined");
  const [view, setView] = useState<PerformanceView>("history");
  const [hist, setHist] = useState<HistoryPayload | null>(null);
  const [internal, setInternal] = useState<InternalPayload | null>(null);
  const [internalLoading, setInternalLoading] = useState(false);
  const [histLoading, setHistLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enabledIds, setEnabledIds] = useState<PerformanceBenchmarkId[]>(() =>
    PERFORMANCE_BENCHMARKS.map((b) => b.id),
  );
  const [prefsReady, setPrefsReady] = useState(false);
  const method = useSyncExternalStore(subscribeInternalMethod, readInternalMethod, () => "capital" as InternalMethod);
  const methodLabel = INTERNAL_METHODS.find((item) => item.id === method)?.label ?? "Capital";

  useEffect(() => {
    const stored = storedBenchmarkIds();
    if (stored) setEnabledIds(stored);
    setPrefsReady(true);
  }, []);

  useEffect(() => {
    if (!prefsReady) return;
    window.localStorage.setItem(BENCHMARK_PREF_KEY, JSON.stringify(enabledIds));
  }, [enabledIds, prefsReady]);

  useEffect(() => {
    try {
      window.localStorage.setItem(INTERNAL_METHOD_KEY, method);
    } catch {
      /* ignore private mode */
    }
    if (view !== "internal") return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("method") === method) return;
    url.searchParams.set("method", method);
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, [method, view]);

  const enabled = useMemo(() => new Set(enabledIds), [enabledIds]);

  function toggleBenchmark(id: PerformanceBenchmarkId) {
    setEnabledIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  useEffect(() => {
    let cancelled = false;
    setHistLoading(true);
    void (async () => {
      try {
        const url = `/api/performance/history?timeframe=ALL&bucket=${encodeURIComponent(bucket)}`;
        const resp = await fetch(url, { cache: "no-store" });
        const json = (await safeJson(resp)) as HistoryPayload;
        if (!cancelled) {
          if (json.ok) setHist(json);
          else setHist({ ok: false, error: json.error ?? "Failed to load history" });
        }
      } catch (e) {
        if (!cancelled) setHist({ ok: false, error: e instanceof Error ? e.message : String(e) });
      } finally {
        if (!cancelled) setHistLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bucket]);

  useEffect(() => {
    if (view !== "internal") return;
    let cancelled = false;
    setInternalLoading(true);
    void (async () => {
      try {
        const url = `/api/performance/internal?bucket=${encodeURIComponent(bucket)}&method=${encodeURIComponent(method)}`;
        const resp = await fetch(url, { cache: "no-store" });
        const json = (await safeJson(resp)) as InternalPayload;
        if (!cancelled) {
          if (json.ok) setInternal(json);
          else setInternal({ ok: false, error: json.error ?? "Failed to load internal performance" });
        }
      } catch (e) {
        if (!cancelled) setInternal({ ok: false, error: e instanceof Error ? e.message : String(e) });
      } finally {
        if (!cancelled) setInternalLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bucket, method, view]);

  const chartData = useMemo((): ChartRow[] => {
    const rows = hist?.chart_data ?? [];
    if (rows.length === 0) return [];

    return rows.map((r) => ({
      asOf: r.date,
      asOfLabel: formatDisplayDate(r.date, { fallback: r.date }),
      seqIndex: r.seq_index,
      Portfolio: r.portfolio,
      spy: r.spy,
      qqq: r.qqq,
      iwm: r.iwm ?? null,
      wti: r.wti ?? null,
      btc: r.btc ?? null,
      eth: r.eth ?? null,
    }));
  }, [hist]);

  const seqLabelByIndex = useMemo(() => {
    const m = new Map<number, string>();
    for (const r of chartData) m.set(r.seqIndex, r.asOfLabel);
    return m;
  }, [chartData]);

  const trackingStart = hist?.ok ? hist.meta?.tracking_start : null;
  const trackingResetForward = hist?.ok ? hist.meta?.tracking_reset_forward === true : false;
  const trackingStartLabel = trackingStart ? formatDisplayDate(trackingStart) : "today";

  const missingBenchmarks = PERFORMANCE_BENCHMARKS.filter(
    (b) => enabled.has(b.id) && chartData.length > 0 && chartData.every((row) => row[b.id] == null),
  );
  const benchWarn =
    missingBenchmarks.length > 0
      ? `No daily prices cached yet for ${missingBenchmarks.map((b) => b.label).join(", ")}.`
      : null;

  const returnSummary =
    hist?.ok && hist.total_return_pct != null
      ? `Portfolio ${hist.total_return_pct >= 0 ? "+" : ""}${hist.total_return_pct.toFixed(2)}% since tracking began${
          hist.vs_spy != null ? ` (vs SPY ${hist.vs_spy >= 0 ? "+" : ""}${hist.vs_spy.toFixed(2)}%)` : ""
        }`
      : null;

  return (
    <div className="flex w-full max-w-[108rem] flex-1 flex-col gap-8 py-10 pl-5 pr-6 sm:pl-6 sm:pr-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            <EditablePageHeading pageId="performance" defaultTitle="Performance" />
          </h1>
          <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Cumulative % change from the first tracked trading day (weekdays only). Portfolio totals match the
            terminal quick glance: Schwab liquidation value plus external holdings, not reverse-engineered position
            math. Benchmarks share that scale — toggle a name to show or hide its line.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/connections"
            className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 shadow-sm hover:bg-zinc-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5"
          >
            Connections
          </Link>
          <Link
            href="/allocation"
            className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 shadow-sm hover:bg-zinc-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5"
          >
            Allocation
          </Link>
        </div>
      </div>

      <DraggableTileLayout
        storageKey="fh.performance.tiles.v1"
        defaultOrder={["controls", "chart"]}
        tiles={{
          controls: {
            title: "Bucket & range",
            bodyClassName: "p-0",
            children: (
              <>
        <div
          className="space-y-3 border-b border-teal-200/80 bg-teal-50 px-4 py-3 text-sm text-teal-950 dark:border-teal-900/50 dark:bg-teal-950/30 dark:text-teal-100"
          role="status"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <p className="min-w-0 flex-1 leading-relaxed">
              {trackingResetForward ? (
                <>
                  Performance tracking reset on <span className="font-semibold">{trackingStartLabel}</span> using Schwab
                  liquidation data. Earlier calculated history was dropped because fewer than two recent trading days of
                  aligned data were available.
                </>
              ) : (
                <>
                  Performance tracking began on <span className="font-semibold">{trackingStartLabel}</span> using Schwab
                  liquidation plus external holdings (same source as the terminal portfolio tile). All series show
                  cumulative % change from that first trading day.
                </>
              )}
            </p>
            <TrackingDurationClock startIso={trackingStart} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="text-sm font-medium text-teal-900 dark:text-teal-100">View</div>
              {(
                [
                  ["history", "Portfolio"],
                  ["internal", "Internal performance"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={view === id}
                  onClick={() => setView(id)}
                  className={
                    "rounded-full px-4 py-2 text-sm font-medium " +
                    (view === id
                      ? "bg-teal-800 text-white shadow-sm dark:bg-teal-200 dark:text-teal-950"
                      : "border border-teal-300/80 bg-white/80 text-teal-950 shadow-sm hover:bg-white dark:border-teal-800/60 dark:bg-teal-950/40 dark:text-teal-50 dark:hover:bg-teal-950/60")
                  }
                >
                  {label}
                </button>
              ))}
              {view === "internal" ? (
                <>
                  <div className="text-sm font-medium text-teal-900 dark:text-teal-100">Return</div>
                  {INTERNAL_METHODS.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      aria-pressed={method === item.id}
                      title={item.hint}
                      onClick={() => publishInternalMethod(item.id)}
                      className={
                        "cursor-help rounded-full px-4 py-2 text-sm font-medium " +
                        (method === item.id
                          ? "bg-teal-800 text-white shadow-sm dark:bg-teal-200 dark:text-teal-950"
                          : "border border-teal-300/80 bg-white/80 text-teal-950 shadow-sm hover:bg-white dark:border-teal-800/60 dark:bg-teal-950/40 dark:text-teal-50 dark:hover:bg-teal-950/60")
                      }
                    >
                      {item.label}
                    </button>
                  ))}
                </>
              ) : null}
              <div className="text-sm font-medium text-teal-900 dark:text-teal-100">Bucket</div>
              {(["combined", "retirement", "brokerage"] as const).map((b) => (
                <button
                  key={b}
                  type="button"
                  onClick={() => setBucket(b)}
                  className={
                    "rounded-full px-4 py-2 text-sm font-medium " +
                    (bucket === b
                      ? "bg-teal-800 text-white shadow-sm dark:bg-teal-200 dark:text-teal-950"
                      : "border border-teal-300/80 bg-white/80 text-teal-950 shadow-sm hover:bg-white dark:border-teal-800/60 dark:bg-teal-950/40 dark:text-teal-50 dark:hover:bg-teal-950/60")
                  }
                >
                  {b === "combined" ? "Combined" : b === "retirement" ? "Retirement" : "Brokerage"}
                </button>
              ))}
            </div>
            <div className="text-sm text-teal-800 dark:text-teal-200/90">
              Range: <span className="font-medium text-teal-950 dark:text-teal-50">All history (to date)</span>
            </div>
          </div>
        </div>

        <div className="px-4 py-3">
        {view === "internal" ? (
          <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Each line uses the return method selected above. The portfolio line and the dotted stock line stay on
            their own scale. Only positions open on the latest holdings snapshot are included. The eight largest by
            market value start on. A dotted line is that ticker&apos;s close-to-close stock return from the first
            chart date, and it stops when the last mark is more than five days old. Hover a return method for what
            it divides by.
          </p>
        ) : (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm" role="group" aria-label="Benchmarks">
          <div className="inline-flex items-center gap-2 px-1 text-zinc-700 dark:text-zinc-200">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: PORTFOLIO_LINE_COLOR }} />
            <span style={{ color: PORTFOLIO_LINE_COLOR }}>Portfolio</span>
          </div>
          {PERFORMANCE_BENCHMARKS.map((b) => {
            const on = enabled.has(b.id);
            return (
              <button
                key={b.id}
                type="button"
                aria-pressed={on}
                onClick={() => toggleBenchmark(b.id)}
                className={
                  "inline-flex items-center gap-2 rounded-full border bg-white/80 px-2.5 py-1 text-sm font-medium dark:bg-zinc-950/40 " +
                  (on ? "" : "opacity-45")
                }
                style={{ color: b.color, borderColor: b.color }}
              >
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={
                    on
                      ? { backgroundColor: b.color }
                      : { backgroundColor: "transparent", boxShadow: `inset 0 0 0 1.5px ${b.color}` }
                  }
                />
                <span style={{ color: b.color }}>{b.label}</span>
              </button>
            );
          })}
          {returnSummary ? <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">{returnSummary}</span> : null}
          {benchWarn ? <span className="text-xs text-amber-600 dark:text-amber-400">{benchWarn}</span> : null}
        </div>
        )}

        {error ? (
          <div className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950/30 dark:text-red-200">
            {error}
          </div>
        ) : null}

        {hist && !hist.ok && hist.error ? (
          <div className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            {hist.error}
          </div>
        ) : null}
        </div>
              </>
            ),
          },
          chart: {
            title: view === "internal" ? "Internal performance" : "Relative performance",
            children: view === "internal" ? (
              <InternalPerformancePanel
                loading={internalLoading}
                error={internal && !internal.ok ? (internal.error ?? "Failed to load internal performance") : null}
                symbols={internal?.symbols ?? []}
                rows={internal?.chart_data ?? []}
                methodLabel={methodLabel}
              />
            ) : (
              <>
        {histLoading ? (
          <div className="text-sm text-zinc-600 dark:text-zinc-400">Loading chart…</div>
        ) : chartData.length < 2 ? (
          <div className="text-sm text-zinc-600 dark:text-zinc-400">
            Not enough aligned data yet. Connect Schwab and run syncs — the chart fills from the first trading day with
            Schwab liquidation totals (or resets from today if history is too thin).
          </div>
        ) : (
          <div className="h-80 w-full min-w-0 text-[var(--foreground)]">
            <ResponsiveContainer
              width="100%"
              height="100%"
              minWidth={0}
              minHeight={320}
              initialDimension={{ width: 400, height: 320 }}
            >
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.2} />
                <XAxis
                  type="number"
                  dataKey="seqIndex"
                  domain={["dataMin", "dataMax"]}
                  tickFormatter={(i) => seqLabelByIndex.get(Number(i)) ?? ""}
                  tick={{ fontSize: 12, fill: "currentColor" }}
                  stroke="currentColor"
                  strokeOpacity={0.35}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tickFormatter={(v) => formatPct(Number(v))}
                  tick={{ fontSize: 12, fill: "currentColor" }}
                  stroke="currentColor"
                  strokeOpacity={0.35}
                  width={58}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const row = payload[0]?.payload as ChartRow;
                    return (
                      <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs shadow-md dark:border-white/20 dark:bg-zinc-950">
                        <div className="font-medium text-zinc-900 dark:text-zinc-100">{row.asOfLabel}</div>
                        <div className="mt-1 space-y-0.5">
                          <div style={{ color: PORTFOLIO_LINE_COLOR }}>Portfolio: {formatPct(row.Portfolio)}</div>
                          {PERFORMANCE_BENCHMARKS.filter((b) => enabled.has(b.id) && row[b.id] != null).map((b) => (
                            <div key={b.id} style={{ color: b.color }}>
                              {b.label}: {formatPct(row[b.id]!)}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  }}
                />
                {PERFORMANCE_BENCHMARKS.filter((b) => enabled.has(b.id)).map((b) => (
                  <Line
                    key={b.id}
                    type={filletLinearCurve}
                    dataKey={b.id}
                    name={b.label}
                    strokeWidth={2}
                    dot={false}
                    stroke={b.color}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                ))}
                {/* Rendered last so the portfolio line draws on top of the benchmarks. */}
                <Line
                  type={filletLinearCurve}
                  dataKey="Portfolio"
                  name="Portfolio"
                  strokeWidth={2}
                  dot={false}
                  stroke={PORTFOLIO_LINE_COLOR}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
              </>
            ),
          },
        }}
      />
    </div>
  );
}

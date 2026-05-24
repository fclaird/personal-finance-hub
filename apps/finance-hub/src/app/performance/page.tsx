"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { DraggableTileLayout } from "@/app/components/DraggableTileLayout";
import { formatDisplayDate } from "@/lib/formatDate";

type HistoryChartRow = {
  date: string;
  seq_index: number;
  portfolio: number;
  spy: number | null;
  qqq: number | null;
};

type HistoryPayload = {
  ok: boolean;
  chart_data?: HistoryChartRow[];
  meta?: {
    source_mix?: string;
    tracking_start?: string | null;
    benchmark_spy_rows?: number;
    benchmark_qqq_rows?: number;
  };
  total_return_pct?: number | null;
  vs_spy?: number | null;
  vs_qqq?: number | null;
  error?: string;
};

type ChartRow = {
  asOf: string;
  asOfLabel: string;
  seqIndex: number;
  Portfolio: number;
  SPY: number | null;
  QQQ: number | null;
};

function formatPct(v: number) {
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}%`;
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
  const [hist, setHist] = useState<HistoryPayload | null>(null);
  const [histLoading, setHistLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const chartData = useMemo((): ChartRow[] => {
    const rows = hist?.chart_data ?? [];
    if (rows.length === 0) return [];

    return rows.map((r) => ({
      asOf: r.date,
      asOfLabel: formatDisplayDate(r.date, { fallback: r.date }),
      seqIndex: r.seq_index,
      Portfolio: r.portfolio,
      SPY: r.spy,
      QQQ: r.qqq,
    }));
  }, [hist]);

  const seqLabelByIndex = useMemo(() => {
    const m = new Map<number, string>();
    for (const r of chartData) m.set(r.seqIndex, r.asOfLabel);
    return m;
  }, [chartData]);

  const COLORS = {
    portfolio: "#0f766e",
    SPY: "#2563eb",
    QQQ: "#7c3aed",
  } as const;

  const trackingStart = hist?.ok ? hist.meta?.tracking_start : null;
  const trackingStartLabel = trackingStart ? formatDisplayDate(trackingStart) : "May 8, 2026";

  const benchWarn =
    hist?.ok && (hist.meta?.benchmark_spy_rows ?? 0) === 0
      ? "No SPY daily prices in the local cache yet. Benchmark lines stay hidden until Schwab price history loads."
      : null;

  const returnSummary =
    hist?.ok && hist.total_return_pct != null
      ? `Portfolio ${hist.total_return_pct >= 0 ? "+" : ""}${hist.total_return_pct.toFixed(2)}% since tracking began${
          hist.vs_spy != null ? ` (vs SPY ${hist.vs_spy >= 0 ? "+" : ""}${hist.vs_spy.toFixed(2)}%)` : ""
        }`
      : null;

  return (
    <div className="flex w-full max-w-[108rem] flex-1 flex-col gap-8 py-10 pl-5 pr-6 sm:pl-6 sm:pr-8">
      <div
        className="rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm leading-relaxed text-teal-950 dark:border-teal-900/50 dark:bg-teal-950/30 dark:text-teal-100"
        role="status"
      >
        Performance logging began on{" "}
        <span className="font-semibold">{trackingStartLabel}</span>, when the program was initiated. All series below
        show cumulative % change from that first trading day — a straight comparison of relative performance.
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Performance</h1>
          <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Cumulative % change from the first tracked trading day (weekdays only). Portfolio vs SPY and QQQ on the
            same scale. Lines connect trading days with straight segments — no smoothing.
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
            children: (
              <>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="text-sm font-medium">Bucket</div>
            {(["combined", "retirement", "brokerage"] as const).map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => setBucket(b)}
                className={
                  "rounded-full px-4 py-2 text-sm font-medium " +
                  (bucket === b
                    ? "bg-zinc-950 text-white dark:bg-white dark:text-black"
                    : "border border-zinc-300 bg-white text-zinc-900 shadow-sm hover:bg-zinc-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5")
                }
              >
                {b === "combined" ? "Combined" : b === "retirement" ? "Retirement" : "Brokerage"}
              </button>
            ))}
          </div>
          <div className="text-sm text-zinc-600 dark:text-zinc-400">
            Range: <span className="font-medium text-zinc-800 dark:text-zinc-200">All history (to date)</span>
          </div>
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-4 text-sm text-zinc-600 dark:text-zinc-400">
          <div className="inline-flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: COLORS.portfolio }} />
            <span>Portfolio</span>
          </div>
          <div className="inline-flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: COLORS.SPY }} />
            <span>SPY</span>
          </div>
          <div className="inline-flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: COLORS.QQQ }} />
            <span>QQQ</span>
          </div>
          {returnSummary ? <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">{returnSummary}</span> : null}
          {benchWarn ? <span className="text-xs text-amber-600 dark:text-amber-400">{benchWarn}</span> : null}
        </div>

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
              </>
            ),
          },
          chart: {
            title: "Relative performance",
            children: (
              <>
        {histLoading ? (
          <div className="text-sm text-zinc-600 dark:text-zinc-400">Loading chart…</div>
        ) : chartData.length < 2 ? (
          <div className="text-sm text-zinc-600 dark:text-zinc-400">
            Not enough data yet. Connect Schwab and run a few syncs — the chart will populate from your first tracked
            trading day forward.
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
                        <div className="mt-1 space-y-0.5 text-zinc-700 dark:text-zinc-300">
                          <div>Portfolio: {formatPct(row.Portfolio)}</div>
                          {row.SPY != null ? <div>SPY: {formatPct(row.SPY)}</div> : null}
                          {row.QQQ != null ? <div>QQQ: {formatPct(row.QQQ)}</div> : null}
                        </div>
                      </div>
                    );
                  }}
                />
                <Line
                  type="linear"
                  dataKey="Portfolio"
                  name="Portfolio"
                  strokeWidth={2}
                  dot={false}
                  stroke={COLORS.portfolio}
                  isAnimationActive={false}
                />
                <Line
                  type="linear"
                  dataKey="SPY"
                  name="SPY"
                  strokeWidth={2}
                  dot={false}
                  stroke={COLORS.SPY}
                  connectNulls={false}
                  isAnimationActive={false}
                />
                <Line
                  type="linear"
                  dataKey="QQQ"
                  name="QQQ"
                  strokeWidth={2}
                  dot={false}
                  stroke={COLORS.QQQ}
                  connectNulls={false}
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

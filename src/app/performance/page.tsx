"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  Area,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { usePrivacy } from "@/app/components/PrivacyProvider";
import { formatUsd2 } from "@/lib/format";
import { formatDisplayDate } from "@/lib/formatDate";
import { timeframeToWindowRangeMs, type PerformanceHistoryTimeframe } from "@/lib/portfolio/performanceWindow";

type TodayPayload = { ok: boolean; portfolioPct: number | null; SPY: number | null; QQQ: number | null };

type HistoryChartRow = {
  date: string;
  x_ms: number;
  portfolio: number;
  spy: number | null;
  qqq: number | null;
  raw_portfolio_value: number;
  spy_close: number | null;
  qqq_close: number | null;
};

type HistoryPayload = {
  ok: boolean;
  chart_data?: HistoryChartRow[];
  meta?: {
    source_mix?: string;
    useToday?: boolean;
    note?: string;
    window_start_ms?: number;
    window_end_ms?: number;
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
  xMs: number;
  portfolio: number;
  portfolioPos: number;
  portfolioNeg: number;
  SPY: number | null;
  SPYPos: number | null;
  SPYNeg: number | null;
  QQQ: number | null;
  QQQPos: number | null;
  QQQNeg: number | null;
  raw_portfolio_value?: number;
  spy_close?: number | null;
  qqq_close?: number | null;
};

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
  const privacy = usePrivacy();
  const [bucket, setBucket] = useState<"combined" | "retirement" | "brokerage">("combined");
  const [windowKey, setWindowKey] = useState<"1D" | "1W" | "1M" | "3M" | "6M" | "1Y" | "3Y" | "5Y">("6M");
  const [today, setToday] = useState<TodayPayload | null>(null);
  const [hist, setHist] = useState<HistoryPayload | null>(null);
  const [histLoading, setHistLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setError(null);
      try {
        const tResp = await fetch("/api/performance/today", { cache: "no-store" });
        const tJson = (await safeJson(tResp)) as TodayPayload;
        if (tJson.ok) setToday(tJson);
        else setToday(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setToday(null);
      }
    })();
  }, [bucket]);

  useEffect(() => {
    if (windowKey === "1D") {
      setHist(null);
      setHistLoading(false);
      return;
    }
    let cancelled = false;
    setHistLoading(true);
    void (async () => {
      try {
        const url = `/api/performance/history?timeframe=${encodeURIComponent(windowKey)}&bucket=${encodeURIComponent(bucket)}`;
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
  }, [windowKey, bucket]);

  const chartData = useMemo((): ChartRow[] => {
    const endMs = Date.now();
    if (windowKey === "1D") {
      const startMs = endMs - 86400000;
      const p = today?.portfolioPct ?? null;
      const spy = today?.SPY ?? null;
      const qqq = today?.QQQ ?? null;
      return [
        {
          asOf: "start",
          asOfLabel: "Start",
          xMs: startMs,
          portfolio: 0,
          portfolioPos: 0,
          portfolioNeg: 0,
          SPY: 0,
          SPYPos: 0,
          SPYNeg: 0,
          QQQ: 0,
          QQQPos: 0,
          QQQNeg: 0,
        },
        {
          asOf: "now",
          asOfLabel: "Now",
          xMs: endMs,
          portfolio: p ?? 0,
          portfolioPos: Math.max(0, p ?? 0),
          portfolioNeg: Math.min(0, p ?? 0),
          SPY: spy ?? 0,
          SPYPos: Math.max(0, spy ?? 0),
          SPYNeg: Math.min(0, spy ?? 0),
          QQQ: qqq ?? 0,
          QQQPos: Math.max(0, qqq ?? 0),
          QQQNeg: Math.min(0, qqq ?? 0),
        },
      ];
    }

    const rows = hist?.chart_data ?? [];
    if (rows.length === 0) return [];

    return rows.map((r) => {
      const portfolio = r.portfolio;
      const spy = r.spy;
      const qqq = r.qqq;
      const xMs =
        typeof r.x_ms === "number" && Number.isFinite(r.x_ms)
          ? r.x_ms
          : Date.UTC(
              Number(r.date.slice(0, 4)),
              Number(r.date.slice(5, 7)) - 1,
              Number(r.date.slice(8, 10)),
              12,
              0,
              0,
            );
      return {
        asOf: r.date,
        asOfLabel: formatDisplayDate(r.date, { fallback: r.date }),
        xMs,
        portfolio,
        portfolioPos: Math.max(0, portfolio),
        portfolioNeg: Math.min(0, portfolio),
        SPY: spy,
        SPYPos: spy == null ? null : Math.max(0, spy),
        SPYNeg: spy == null ? null : Math.min(0, spy),
        QQQ: qqq,
        QQQPos: qqq == null ? null : Math.max(0, qqq),
        QQQNeg: qqq == null ? null : Math.min(0, qqq),
        raw_portfolio_value: r.raw_portfolio_value,
        spy_close: r.spy_close,
        qqq_close: r.qqq_close,
      };
    });
  }, [windowKey, today, hist]);

  const windowXDomain = useMemo((): [number, number] => {
    const endMs = Date.now();
    if (windowKey === "1D") return [endMs - 86400000, endMs];
    const wk = windowKey as PerformanceHistoryTimeframe;
    if (hist?.ok && hist.meta?.window_start_ms != null && hist.meta?.window_end_ms != null) {
      return [hist.meta.window_start_ms, hist.meta.window_end_ms];
    }
    const { startMs, endMs: e } = timeframeToWindowRangeMs(wk, endMs);
    return [startMs, e];
  }, [windowKey, hist]);

  const COLORS = {
    portfolio: "#0f766e",
    SPY: "#2563eb",
    QQQ: "#7c3aed",
  } as const;

  const histNote =
    windowKey !== "1D" && hist?.ok && hist.meta?.source_mix
      ? hist.meta.source_mix === "snapshots"
        ? "Long windows use weekly portfolio snapshots with SPY/QQQ on the same dates."
        : "Using dense sync points in this window (few weekly snapshots yet)."
      : null;

  const benchWarn =
    windowKey !== "1D" && hist?.ok && (hist.meta?.benchmark_spy_rows ?? 0) === 0
      ? "No SPY daily prices in the local cache yet (Schwab market pricehistory may be empty or blocked). Benchmark lines stay hidden until data loads."
      : null;

  return (
    <div className="flex w-full max-w-[108rem] flex-1 flex-col gap-8 py-10 pl-5 pr-6 sm:pl-6 sm:pr-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Performance</h1>
          <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            1D uses live day change. Longer windows use weekly portfolio snapshots (backfilled from sync history) with SPY
            and QQQ closes aligned per date. Run <code className="rounded bg-zinc-100 px-1 dark:bg-white/10">npm run backfill:portfolio-snapshots</code> once to populate history.
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

      <section className="rounded-2xl border border-zinc-300 bg-white p-6 shadow-sm dark:border-white/20 dark:bg-zinc-950">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
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

          <div className="flex flex-wrap items-center gap-2">
            <div className="text-sm font-medium">Window</div>
            {(["1D", "1W", "1M", "3M", "6M", "1Y", "3Y", "5Y"] as const).map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => setWindowKey(w)}
                className={
                  "rounded-full px-3 py-1.5 text-sm font-medium " +
                  (windowKey === w
                    ? "bg-zinc-950 text-white dark:bg-white dark:text-black"
                    : "border border-zinc-300 bg-white text-zinc-900 shadow-sm hover:bg-zinc-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5")
                }
              >
                {w}
              </button>
            ))}
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
          {histNote ? <span className="text-xs text-zinc-500 dark:text-zinc-500">{histNote}</span> : null}
          {benchWarn ? <span className="text-xs text-amber-600 dark:text-amber-400">{benchWarn}</span> : null}
        </div>

        {error ? (
          <div className="rounded-xl bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950/30 dark:text-red-200">
            {error}
          </div>
        ) : null}

        {windowKey !== "1D" && hist && !hist.ok && hist.error ? (
          <div className="mb-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            {hist.error}
          </div>
        ) : null}

        {histLoading ? (
          <div className="text-sm text-zinc-600 dark:text-zinc-400">Loading chart…</div>
        ) : chartData.length < 2 ? (
          <div className="text-sm text-zinc-600 dark:text-zinc-400">
            Not enough data yet. Sync Schwab a few times, then run{" "}
            <code className="rounded bg-zinc-100 px-1 dark:bg-white/10">npm run backfill:portfolio-snapshots</code>.
          </div>
        ) : (
          <div className="h-80 w-full min-w-0">
            <ResponsiveContainer
              width="100%"
              height="100%"
              minWidth={0}
              minHeight={320}
              initialDimension={{ width: 400, height: 320 }}
            >
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  type="number"
                  dataKey="xMs"
                  domain={windowXDomain}
                  tickFormatter={(ms) => formatDisplayDate(new Date(Number(ms)).toISOString(), { short: true })}
                  tick={{ fontSize: 10 }}
                  stroke="rgba(113,113,122,0.5)"
                />
                <YAxis tickFormatter={(v) => `${Number(v).toFixed(0)}%`} />
                <ReferenceLine y={0} stroke="rgba(113,113,122,0.6)" />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const row = payload[0]?.payload as ChartRow;
                    const mask = privacy.masked;
                    return (
                      <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs shadow-md dark:border-white/20 dark:bg-zinc-950">
                        <div className="font-medium text-zinc-900 dark:text-zinc-100">{row.asOfLabel}</div>
                        <div className="mt-1 space-y-0.5 text-zinc-700 dark:text-zinc-300">
                          <div>Portfolio: {Number(row.portfolio).toFixed(2)}%</div>
                          {row.raw_portfolio_value != null ? (
                            <div>Value: {formatUsd2(row.raw_portfolio_value, { mask })}</div>
                          ) : null}
                          {row.SPY != null ? <div>SPY: {Number(row.SPY).toFixed(2)}%</div> : null}
                          {row.spy_close != null ? <div>SPY close: {formatUsd2(row.spy_close, { mask })}</div> : null}
                          {row.QQQ != null ? <div>QQQ: {Number(row.QQQ).toFixed(2)}%</div> : null}
                          {row.qqq_close != null ? <div>QQQ close: {formatUsd2(row.qqq_close, { mask })}</div> : null}
                        </div>
                      </div>
                    );
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="portfolioPos"
                  name="Portfolio (above)"
                  stroke="none"
                  fill="rgba(16,185,129,0.18)"
                  baseValue={0}
                  isAnimationActive={false}
                />
                <Area
                  type="monotone"
                  dataKey="portfolioNeg"
                  name="Portfolio (below)"
                  stroke="none"
                  fill="rgba(239,68,68,0.18)"
                  baseValue={0}
                  isAnimationActive={false}
                />
                <Area
                  type="monotone"
                  dataKey="SPYPos"
                  name="SPY (above)"
                  stroke="none"
                  fill="rgba(16,185,129,0.10)"
                  baseValue={0}
                  isAnimationActive={false}
                />
                <Area
                  type="monotone"
                  dataKey="SPYNeg"
                  name="SPY (below)"
                  stroke="none"
                  fill="rgba(239,68,68,0.10)"
                  baseValue={0}
                  isAnimationActive={false}
                />
                <Area
                  type="monotone"
                  dataKey="QQQPos"
                  name="QQQ (above)"
                  stroke="none"
                  fill="rgba(16,185,129,0.10)"
                  baseValue={0}
                  isAnimationActive={false}
                />
                <Area
                  type="monotone"
                  dataKey="QQQNeg"
                  name="QQQ (below)"
                  stroke="none"
                  fill="rgba(239,68,68,0.10)"
                  baseValue={0}
                  isAnimationActive={false}
                />
                <Line type="monotone" dataKey="portfolio" name="Portfolio" strokeWidth={2} dot={false} stroke={COLORS.portfolio} />
                <Line
                  type="monotone"
                  dataKey="SPY"
                  name="SPY"
                  strokeWidth={2}
                  dot={false}
                  stroke={COLORS.SPY}
                  connectNulls={false}
                />
                <Line
                  type="monotone"
                  dataKey="QQQ"
                  name="QQQ"
                  strokeWidth={2}
                  dot={false}
                  stroke={COLORS.QQQ}
                  connectNulls={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>
    </div>
  );
}

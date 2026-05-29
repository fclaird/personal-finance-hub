"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { SymbolCandlestickChart } from "@/app/components/terminal/SymbolCandlestickChart";
import {
  coerceIntervalForWindow,
  type CandleWindowKey,
  type ChartCandleInterval,
} from "@/lib/terminal/candleChartConfig";
import type { CandleChartRow } from "@/lib/terminal/candlestickRender";
import { useChartTimeRange } from "@/hooks/useChartTimeRange";
import { extendFetchStartMs } from "@/lib/terminal/candleWindowTime";
import { posNegClass } from "@/lib/terminal/colors";

const PCT2 = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type CandlesApiResponse = {
  ok: boolean;
  candles?: Array<{
    tsMs: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;
  loadedFromMs?: number;
  loadedToMs?: number;
  benchmarks?: {
    QQQ?: Array<{ tsMs: number; pct: number }>;
    SPY?: Array<{ tsMs: number; pct: number }>;
  };
  error?: string;
};

function mergeCandleRows(
  candles: NonNullable<CandlesApiResponse["candles"]>,
  benchmarks?: CandlesApiResponse["benchmarks"],
): CandleChartRow[] {
  const qqqByTs = new Map(benchmarks?.QQQ?.map((p) => [p.tsMs, p.pct]) ?? []);
  const spyByTs = new Map(benchmarks?.SPY?.map((p) => [p.tsMs, p.pct]) ?? []);
  return candles.map((c) => ({
    ...c,
    qqqPct: qqqByTs.get(c.tsMs) ?? null,
    spyPct: spyByTs.get(c.tsMs) ?? null,
  }));
}

export type SymbolCandleChartPanelProps = {
  symbol: string;
  windowKey: CandleWindowKey;
  candleInterval: ChartCandleInterval;
  quoteChangePct?: number | null;
};

export function SymbolCandleChartPanel({
  symbol,
  windowKey,
  candleInterval,
  quoteChangePct,
}: SymbolCandleChartPanelProps) {
  const [rows, setRows] = useState<CandleChartRow[]>([]);
  const [loadedFromMs, setLoadedFromMs] = useState<number | null>(null);
  const [loadedToMs, setLoadedToMs] = useState<number | null>(null);
  const [fetchStartMs, setFetchStartMs] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const interval = coerceIntervalForWindow(windowKey, candleInterval);
  const resetKey = `${symbol}|${windowKey}|${interval}|${fetchStartMs ?? ""}`;

  useEffect(() => {
    setRows([]);
    setLoadedFromMs(null);
    setLoadedToMs(null);
    setFetchStartMs(undefined);
    setLoading(true);
    setError(null);
  }, [symbol, windowKey, interval]);

  const timeRange = useChartTimeRange({
    window: windowKey,
    loadedFromMs,
    loadedToMs,
    resetKey,
  });

  const loadCandles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        symbol,
        window: windowKey,
        interval,
        benchmarks: "1",
      });
      if (fetchStartMs != null) qs.set("startMs", String(fetchStartMs));
      const resp = await fetch(`/api/terminal/candles?${qs.toString()}`, { cache: "no-store" });
      const text = await resp.text();
      let json: CandlesApiResponse;
      try {
        json = text ? (JSON.parse(text) as CandlesApiResponse) : { ok: false };
      } catch {
        setError(resp.ok ? "Invalid candle response" : `Failed to load candles (${resp.status})`);
        setRows([]);
        return;
      }
      if (!resp.ok || !json.ok) {
        setError(json.error ?? `Failed to load candles (${resp.status})`);
        setRows([]);
        return;
      }
      const candles = json.candles ?? [];
      if (candles.length === 0) {
        setError("No candle data yet");
        setRows([]);
        return;
      }
      setRows(mergeCandleRows(candles, json.benchmarks));
      setLoadedFromMs(json.loadedFromMs ?? candles[0]?.tsMs ?? null);
      setLoadedToMs(json.loadedToMs ?? candles[candles.length - 1]?.tsMs ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [symbol, windowKey, interval, fetchStartMs]);

  useEffect(() => {
    void loadCandles();
  }, [loadCandles]);

  useEffect(() => {
    if (!timeRange.needsEarlierData || loadedFromMs == null) return;
    const next = extendFetchStartMs(windowKey, loadedFromMs);
    if (fetchStartMs == null || next < fetchStartMs) {
      // #region agent log
      fetch("http://127.0.0.1:7246/ingest/2ceda99a-8078-4e27-9f3d-2d8ce02fa8d7", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "b0a6ec" },
        body: JSON.stringify({
          sessionId: "b0a6ec",
          runId: "post-fix-needsEarlier",
          location: "SymbolCandleChartPanel.tsx:extend",
          message: "extend fetch triggered",
          hypothesisId: "C6",
          timestamp: Date.now(),
          data: { symbol, windowKey, next, loadedFromMs, fetchStartMs: fetchStartMs ?? null },
        }),
      }).catch(() => {});
      // #endregion
      setFetchStartMs(next);
    }
  }, [timeRange.needsEarlierData, loadedFromMs, windowKey, fetchStartMs, symbol]);

  const aggregatedNote =
    interval === "60m" || interval === "240m"
      ? "1h and 4h bars are aggregated from 30-minute Schwab data."
      : undefined;

  const footerPct = useMemo(() => {
    if (rows.length < 2) return { sym: quoteChangePct ?? null, qqq: null as number | null, spy: null as number | null };
    const first = rows[0]!;
    const last = rows[rows.length - 1]!;
    const symPct = first.close > 0 ? ((last.close / first.close) - 1) * 100 : null;
    return {
      sym: symPct ?? quoteChangePct ?? null,
      qqq: last.qqqPct ?? null,
      spy: last.spyPct ?? null,
    };
  }, [rows, quoteChangePct]);

  if (loading && rows.length === 0) {
    return <div className="text-sm text-zinc-600 dark:text-zinc-400">Loading candles…</div>;
  }
  if (error && rows.length === 0) {
    return <div className="text-sm text-red-600 dark:text-red-400">{error}</div>;
  }

  return (
    <div>
      <SymbolCandlestickChart
        data={rows}
        brushData={rows}
        windowKey={windowKey}
        symbolLabel={symbol}
        visibleRange={timeRange.visibleRange}
        onVisibleRangeChange={timeRange.setVisibleRange}
        onWheelPan={timeRange.onWheelPan}
        height={288}
        className="h-72 w-full min-w-0"
        aggregatedNote={aggregatedNote}
      />
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <FooterStat label={symbol} pct={footerPct.sym} color="#0f766e" />
        <FooterStat label="QQQ" pct={footerPct.qqq} color="#0891b2" />
        <FooterStat label="SPY" pct={footerPct.spy} color="#16a34a" />
      </div>
    </div>
  );
}

function FooterStat({ label, pct, color }: { label: string; pct: number | null; color: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden />
      <span className="font-medium text-zinc-700 dark:text-zinc-200">{label}</span>
      <span className={"ml-auto tabular-nums " + posNegClass(pct)}>
        {pct == null ? "—" : `${pct >= 0 ? "+" : ""}${PCT2.format(pct)}%`}
      </span>
    </div>
  );
}

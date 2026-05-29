import { NextResponse } from "next/server";

import {
  coerceIntervalForWindow,
  isChartCandleInterval,
  type CandleWindowKey,
  type ChartCandleInterval,
} from "@/lib/terminal/candleChartConfig";
import {
  benchmarkPctOverlay,
  ensureChartCandles,
  getChartCandles,
  windowSinceMs,
  type CandleWindow,
} from "@/lib/terminal/ohlcv";

function normSym(s: string) {
  return (s ?? "").trim().toUpperCase();
}

const WINDOWS = new Set(["1D", "5D", "1M", "3M", "6M", "1Y", "3Y", "5Y"]);

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const symbol = normSym(url.searchParams.get("symbol") ?? "");
    const window = (url.searchParams.get("window") ?? "6M").trim().toUpperCase() as CandleWindow;
    const intervalRaw = (url.searchParams.get("interval") ?? "").trim();
    const explicitStartMs = parseOptionalMs(url.searchParams.get("startMs"));
    const endMs = parseOptionalMs(url.searchParams.get("endMs"));
    const includeBenchmarks = url.searchParams.get("benchmarks") !== "0";

    if (!symbol) return NextResponse.json({ ok: false, error: "Missing symbol", candles: [] }, { status: 400 });
    if (!WINDOWS.has(window)) {
      return NextResponse.json({ ok: false, error: "Invalid window", candles: [] }, { status: 400 });
    }

    const w = window as CandleWindowKey;
    const defaultInterval =
      window === "1D" || window === "5D" ? "5m" : window === "1M" || window === "3M" ? "1d" : "1d";
    const interval: ChartCandleInterval = isChartCandleInterval(intervalRaw)
      ? coerceIntervalForWindow(w, intervalRaw)
      : coerceIntervalForWindow(w, defaultInterval);

    const readSinceMs = explicitStartMs ?? windowSinceMs(window);
    // Only pass range opts to Schwab when the client explicitly extends the window (pan).
    // Default loads use DB cache + period fetch; passing readSinceMs bypasses cache every time.
    const ensureOpts =
      explicitStartMs != null || endMs != null
        ? { startMs: readSinceMs, endMs: endMs ?? undefined }
        : undefined;

    const routeStart = Date.now();
    const ensureTargets = includeBenchmarks ? [symbol, "QQQ", "SPY"] : [symbol];
    await Promise.all(ensureTargets.map((s) => ensureChartCandles(s, interval, window, ensureOpts)));
    const ensureMs = Date.now() - routeStart;

    const candles = getChartCandles(symbol, interval, readSinceMs, endMs ?? undefined, window);

    let benchmarks: { QQQ: Array<{ tsMs: number; pct: number }>; SPY: Array<{ tsMs: number; pct: number }> } | undefined;
    if (includeBenchmarks && candles.length >= 2) {
      const qqqCandles = getChartCandles("QQQ", interval, readSinceMs, endMs ?? undefined, window);
      const spyCandles = getChartCandles("SPY", interval, readSinceMs, endMs ?? undefined, window);
      benchmarks = {
        QQQ: benchmarkPctOverlay(qqqCandles, candles),
        SPY: benchmarkPctOverlay(spyCandles, candles),
      };
    }

    const loadedFromMs = candles.length > 0 ? candles[0]!.tsMs : readSinceMs;
    const loadedToMs = candles.length > 0 ? candles[candles.length - 1]!.tsMs : Date.now();

    // #region agent log
    fetch("http://127.0.0.1:7246/ingest/2ceda99a-8078-4e27-9f3d-2d8ce02fa8d7", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "b0a6ec" },
      body: JSON.stringify({
        sessionId: "b0a6ec",
        runId: "post-fix-needsEarlier",
        location: "candles/route.ts:GET",
        message: "candles timing",
        hypothesisId: "C6",
        timestamp: Date.now(),
        data: {
          symbol,
          window,
          explicitStartMs: explicitStartMs ?? null,
          ensureMs,
          candleCount: candles.length,
          includeBenchmarks,
        },
      }),
    }).catch(() => {});
    // #endregion

    return NextResponse.json({
      ok: true,
      symbol,
      window,
      interval,
      candles,
      n: candles.length,
      loadedFromMs,
      loadedToMs,
      benchmarks,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message, candles: [] }, { status: 500 });
  }
}

function parseOptionalMs(v: string | null): number | undefined {
  if (v == null || v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

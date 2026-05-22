import { NextResponse } from "next/server";

import { ensureCandles, getCachedCandles, type CandleInterval, type CandleWindow } from "@/lib/terminal/ohlcv";

function normSym(s: string) {
  return (s ?? "").trim().toUpperCase();
}

const WINDOWS = new Set(["1D", "5D", "1M", "3M", "6M", "1Y", "3Y", "5Y"]);
const INTERVALS = new Set(["1d", "5m"]);

export async function GET(req: Request) {
  const url = new URL(req.url);
  const symbol = normSym(url.searchParams.get("symbol") ?? "");
  const window = (url.searchParams.get("window") ?? "6M").trim().toUpperCase();
  const interval = (url.searchParams.get("interval") ?? (window === "1D" || window === "5D" ? "5m" : "1d")).trim();

  if (!symbol) return NextResponse.json({ ok: false, error: "Missing symbol" }, { status: 400 });
  if (!WINDOWS.has(window)) return NextResponse.json({ ok: false, error: "Invalid window" }, { status: 400 });
  if (!INTERVALS.has(interval)) return NextResponse.json({ ok: false, error: "Invalid interval" }, { status: 400 });

  const w = window as CandleWindow;
  const i = interval as CandleInterval;
  await ensureCandles(symbol, i, w);

  // Approximate since based on window to keep payload smaller.
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const sinceByWindow: Record<CandleWindow, number> = {
    "1D": now - 2 * day,
    "5D": now - 8 * day,
    "1M": now - 40 * day,
    "3M": now - 110 * day,
    "6M": now - 220 * day,
    "1Y": now - 400 * day,
    "3Y": now - 3 * 400 * day,
    "5Y": now - 5 * 400 * day,
  };
  const candles = getCachedCandles(symbol, i, sinceByWindow[w]);
  return NextResponse.json({ ok: true, symbol, window: w, interval: i, candles, n: candles.length });
}


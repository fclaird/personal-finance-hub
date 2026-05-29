import { isUsEquityOvernightDeadZone } from "@/lib/market/glanceExtendedHours";
import { nyYmd } from "@/lib/market/usEquitySession";
import {
  ensureChartCandles,
  getChartCandles,
  windowSinceMs,
  type Candle,
} from "@/lib/terminal/ohlcv";

export const SPARKLINE_MIN_POINTS = 2;
export const SPARKLINE_MAX_ENSURE = 40;
export const SPARKLINE_ENSURE_CONCURRENCY = 8;

/** NY calendar day for a candle timestamp. */
export function nyYmdForTs(tsMs: number): string {
  return nyYmd(new Date(tsMs));
}

/** Prefer today's session; otherwise the latest day present in the series. */
export function sparklineSessionYmd(candles: readonly { tsMs: number }[], now = new Date()): string {
  const today = nyYmd(now);
  if (candles.some((c) => nyYmdForTs(c.tsMs) === today)) return today;
  let maxYmd = "";
  for (const c of candles) {
    const y = nyYmdForTs(c.tsMs);
    if (y > maxYmd) maxYmd = y;
  }
  return maxYmd || today;
}

/** Intraday closes for one symbol (5m bars, dead-zone trimmed, current session day). */
export function intradaySparklineCloses(symbol: string, now = new Date()): number[] {
  const since = windowSinceMs("1D", now.getTime());
  const candles = getChartCandles(symbol, "5m", since, undefined, "1D");
  return closesForSessionDay(candles, now);
}

export function closesForSessionDay(candles: readonly Candle[], now = new Date()): number[] {
  if (candles.length === 0) return [];
  const ymd = sparklineSessionYmd(candles, now);
  const out: number[] = [];
  for (const c of candles) {
    if (nyYmdForTs(c.tsMs) !== ymd) continue;
    if (isUsEquityOvernightDeadZone(c.tsMs)) continue;
    if (typeof c.close === "number" && Number.isFinite(c.close)) out.push(c.close);
  }
  return out;
}

export async function runPool<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
}

/** Ensure + read intraday sparkline closes for many symbols (DB-first, capped Schwab backfill). */
export async function buildIntradaySparklineSeries(
  symbols: readonly string[],
  opts?: { now?: Date; maxEnsure?: number },
): Promise<Record<string, number[]>> {
  const now = opts?.now ?? new Date();
  const maxEnsure = opts?.maxEnsure ?? SPARKLINE_MAX_ENSURE;
  const series: Record<string, number[]> = {};
  const needEnsure: string[] = [];

  for (const raw of symbols) {
    const sym = (raw ?? "").trim().toUpperCase();
    if (!sym) continue;
    const closes = intradaySparklineCloses(sym, now);
    if (closes.length >= SPARKLINE_MIN_POINTS) {
      series[sym] = closes;
    } else {
      needEnsure.push(sym);
    }
  }

  const toEnsure = needEnsure.slice(0, maxEnsure);
  await runPool(toEnsure, SPARKLINE_ENSURE_CONCURRENCY, async (sym) => {
    try {
      await ensureChartCandles(sym, "5m", "1D");
      const closes = intradaySparklineCloses(sym, now);
      if (closes.length >= SPARKLINE_MIN_POINTS) series[sym] = closes;
    } catch {
      /* decorative — skip */
    }
  });

  return series;
}

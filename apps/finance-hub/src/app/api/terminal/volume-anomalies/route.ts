import { NextResponse } from "next/server";

import { logError } from "@/lib/log";
import { schwabMarketFetch } from "@/lib/schwab/client";
import { schwabQuoteObjectFromEntry } from "@/lib/schwab/quoteEntry";
import { ensureCandles, getCachedCandles, trailingAvgDailyVolume, windowSinceMs } from "@/lib/terminal/ohlcv";

const DAILY_WINDOW = "6M" as const;
const MIN_DAILY_BARS = 100;
const ENSURE_CONCURRENCY = 5;

async function runPool<T>(items: readonly T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift()!;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

function normSym(s: string) {
  return (s ?? "").trim().toUpperCase();
}

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as { symbols?: string[] } | null;
    const symbols = Array.from(new Set((body?.symbols ?? []).map(normSym).filter(Boolean)));
    if (symbols.length === 0) return NextResponse.json({ ok: true, anomalies: {}, n: 0 });

    // Fetch quotes for volume in batches.
    const BATCH = 100;
    const volumes = new Map<string, number | null>();

    for (let i = 0; i < symbols.length; i += BATCH) {
      const batch = symbols.slice(i, i + BATCH);
      const resp = await schwabMarketFetch<Record<string, unknown>>(
        `/quotes?symbols=${encodeURIComponent(batch.join(","))}`,
      );
      for (const sym of batch) {
        const entry = resp[sym] ?? resp[sym.toUpperCase()];
        const q = schwabQuoteObjectFromEntry(entry);
        const vol = q ? asNumber(q.totalVolume ?? q.volume) : null;
        volumes.set(sym, vol);
      }
    }

    // Ensure daily candles (for avg volume). Skip Schwab when DB already has enough bars.
    const sinceMs = windowSinceMs(DAILY_WINDOW);
    await runPool(symbols, ENSURE_CONCURRENCY, async (sym) => {
      try {
        const cached = getCachedCandles(sym, "1d", sinceMs);
        if (cached.length >= MIN_DAILY_BARS) return;
        await ensureCandles(sym, "1d", DAILY_WINDOW);
      } catch {
        // ignore
      }
    });

    const anomalies: Record<
      string,
      { volume: number | null; avgVolume20: number | null; ratio: number | null; flagged: boolean }
    > = {};

    for (const sym of symbols) {
      const volume = volumes.get(sym) ?? null;
      const avg = trailingAvgDailyVolume(sym, 20);
      const ratio = volume != null && avg != null ? volume / avg : null;
      const flagged = ratio != null ? ratio >= 2.5 : false;
      anomalies[sym] = { volume, avgVolume20: avg, ratio, flagged };
    }

    return NextResponse.json({ ok: true, anomalies, n: symbols.length });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logError("terminal_volume_anomalies_post", e);
    return NextResponse.json({ ok: false, error: msg, anomalies: {}, n: 0 }, { status: 502 });
  }
}


import { NextResponse } from "next/server";

import { logError } from "@/lib/log";
import { schwabMarketFetch } from "@/lib/schwab/client";
import { schwabQuoteObjectFromEntry } from "@/lib/schwab/quoteEntry";
import { ensureCandles, trailingAvgDailyVolume } from "@/lib/terminal/ohlcv";

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

    // Ensure daily candles (for avg volume). Keep lightweight: 6M daily.
    for (const sym of symbols) {
      // Best effort; don't fail whole endpoint.
      try {
        await ensureCandles(sym, "1d", "6M");
      } catch {
        // ignore
      }
    }

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


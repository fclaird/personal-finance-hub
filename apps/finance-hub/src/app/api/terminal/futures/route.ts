import { NextResponse } from "next/server";

import { ensureBenchmarkHistory, getCachedBenchmarkSeries } from "@/lib/market/benchmarks";
import { normalizeSchwabQuoteSymbol } from "@/lib/market/schwabSymbol";
import { schwabQuoteDisplayPrice } from "@/lib/market/schwabQuoteDisplay";
import { schwabMarketFetch } from "@/lib/schwab/client";
import { schwabQuoteObjectFromEntry } from "@/lib/schwab/quoteEntry";

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

type NormalizedQuote = {
  symbol: string;
  last: number | null;
  bid: number | null;
  ask: number | null;
  mark: number | null;
  close: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  change: number | null;
  changePercent: number | null;
  updatedAt: string;
};

function parseQuoteBatch(resp: Record<string, unknown>, batch: string[], nowIso: string): NormalizedQuote[] {
  const out: NormalizedQuote[] = [];
  for (const sym of batch) {
    const entry = resp[sym] ?? resp[sym.toUpperCase()];
    const q = schwabQuoteObjectFromEntry(entry);
    if (!q) {
      out.push({
        symbol: sym,
        last: null,
        bid: null,
        ask: null,
        mark: null,
        close: null,
        open: null,
        high: null,
        low: null,
        volume: null,
        change: null,
        changePercent: null,
        updatedAt: nowIso,
      });
      continue;
    }
    const rawLast = asNumber(q.lastPrice) ?? null;
    const bid = asNumber(q.bidPrice ?? q.bid) ?? null;
    const ask = asNumber(q.askPrice ?? q.ask) ?? null;
    const mark = asNumber(q.mark) ?? null;
    const close = asNumber(q.closePrice) ?? null;
    const open = asNumber(q.openPrice) ?? null;
    const high = asNumber(q.highPrice) ?? null;
    const low = asNumber(q.lowPrice) ?? null;
    const volume = asNumber(q.totalVolume ?? q.volume) ?? null;
    const last = schwabQuoteDisplayPrice(rawLast, mark, close);
    const change = asNumber(q.netChange ?? q.change) ?? (last != null && close != null ? last - close : null);
    const changePercent =
      asNumber(q.netPercentChangeInDouble ?? q.changePercent) ??
      (change != null && close != null && close !== 0 ? change / close : null);
    out.push({
      symbol: sym,
      last,
      bid,
      ask,
      mark,
      close,
      open,
      high,
      low,
      volume,
      change,
      changePercent: changePercent == null ? null : changePercent,
      updatedAt: nowIso,
    });
  }
  return out;
}

function configuredFuturesSymbols(): string[] {
  const raw = process.env.TERMINAL_FUTURES_SYMBOLS ?? "";
  if (!raw.trim()) return [];
  return Array.from(
    new Set(
      raw
        .split(",")
        .map((s) => normalizeSchwabQuoteSymbol(s))
        .filter(Boolean),
    ),
  );
}

export async function GET() {
  const symbols = configuredFuturesSymbols();
  if (symbols.length === 0) {
    return NextResponse.json({ ok: true, items: [] as Array<{ symbol: string; quote: NormalizedQuote; series: Array<{ date: string; close: number }> }> });
  }

  const nowIso = new Date().toISOString();
  const quotes: NormalizedQuote[] = [];
  const BATCH = 20;
  for (let i = 0; i < symbols.length; i += BATCH) {
    const batch = symbols.slice(i, i + BATCH);
    try {
      const resp = await schwabMarketFetch<Record<string, unknown>>(`/quotes?symbols=${encodeURIComponent(batch.join(","))}`);
      quotes.push(...parseQuoteBatch(resp, batch, nowIso));
    } catch {
      for (const sym of batch) {
        quotes.push({
          symbol: sym,
          last: null,
          bid: null,
          ask: null,
          mark: null,
          close: null,
          open: null,
          high: null,
          low: null,
          volume: null,
          change: null,
          changePercent: null,
          updatedAt: nowIso,
        });
      }
    }
  }

  const items: Array<{ symbol: string; quote: NormalizedQuote; series: Array<{ date: string; close: number }> }> = [];
  for (const symbol of symbols) {
    const quote = quotes.find((q) => q.symbol === symbol) ?? {
      symbol,
      last: null,
      bid: null,
      ask: null,
      mark: null,
      close: null,
      open: null,
      high: null,
      low: null,
      volume: null,
      change: null,
      changePercent: null,
      updatedAt: nowIso,
    };
    let series: Array<{ date: string; close: number }> = [];
    try {
      await ensureBenchmarkHistory(symbol);
      series = getCachedBenchmarkSeries(symbol).slice(-90);
    } catch {
      series = [];
    }
    const hasData =
      (quote.last != null && Number.isFinite(quote.last)) ||
      (quote.mark != null && Number.isFinite(quote.mark)) ||
      series.length > 0;
    if (!hasData) continue;
    items.push({ symbol, quote, series });
  }

  return NextResponse.json({ ok: true, items });
}

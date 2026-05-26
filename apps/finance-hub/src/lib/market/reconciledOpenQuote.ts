import { fetchStooqQuote } from "@/lib/market/stooqQuoteFetch";
import type { RegionalMarketInstrument } from "@/lib/market/regionalMarketInstruments";
import { fetchYahooIntradayChart } from "@/lib/market/yahooChartFetch";

export type ReconciledOpenQuote = {
  last: number | null;
  previousClose: number | null;
  change: number | null;
  changePct: number | null;
  reconciled: boolean;
  divergencePct: number | null;
  sources: {
    yahoo: number | null;
    yahooBar: number | null;
    stooq: number | null;
  };
  series: Array<{ date: string; close: number }>;
};

function asNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

function divergencePct(a: number, b: number): number {
  const ref = Math.max(Math.abs(a), Math.abs(b), 1e-9);
  return (Math.abs(a - b) / ref) * 100;
}

function pricesAgree(a: number, b: number, tolerancePct = 0.2): boolean {
  return divergencePct(a, b) <= tolerancePct;
}

function yahooLastBarClose(result: Record<string, unknown>): number | null {
  const quote = (result.indicators as Record<string, unknown> | undefined)?.quote as
    | Array<Record<string, unknown>>
    | undefined;
  const closes = (quote?.[0]?.close as Array<number | null> | undefined) ?? [];
  for (let i = closes.length - 1; i >= 0; i--) {
    const c = closes[i];
    if (c != null && Number.isFinite(c)) return c;
  }
  return null;
}

function yahooDailySeries(result: Record<string, unknown>, maxPoints = 90): Array<{ date: string; close: number }> {
  const timestamps = (result.timestamp as number[] | undefined) ?? [];
  const quote = (result.indicators as Record<string, unknown> | undefined)?.quote as
    | Array<Record<string, unknown>>
    | undefined;
  const closes = (quote?.[0]?.close as Array<number | null> | undefined) ?? [];
  const out: Array<{ date: string; close: number }> = [];
  for (let i = 0; i < closes.length; i++) {
    const c = closes[i];
    const ts = timestamps[i];
    if (c == null || ts == null || !Number.isFinite(c)) continue;
    out.push({ date: new Date(ts * 1000).toISOString().slice(0, 10), close: c });
  }
  return out.slice(-maxPoints);
}

/** Cross-reference Yahoo chart vs Stooq (or Yahoo bar) for open-market instruments. */
export async function fetchReconciledOpenQuote(
  instrument: RegionalMarketInstrument,
): Promise<ReconciledOpenQuote> {
  const empty: ReconciledOpenQuote = {
    last: null,
    previousClose: null,
    change: null,
    changePct: null,
    reconciled: false,
    divergencePct: null,
    sources: { yahoo: null, yahooBar: null, stooq: null },
    series: [],
  };

  const [yahoo, stooq] = await Promise.all([
    fetchYahooIntradayChart(instrument.yahooSymbol, instrument.includePrePost ? "5d" : "1d", {
      includePrePost: instrument.includePrePost ?? false,
    }),
    instrument.stooqSymbol ? fetchStooqQuote(instrument.stooqSymbol) : Promise.resolve(null),
  ]);

  if (!yahoo?.result) return empty;

  const meta = yahoo.result.meta as Record<string, unknown> | undefined;
  const yahooMeta =
    asNum(meta?.regularMarketPrice) ??
    asNum(meta?.postMarketPrice) ??
    asNum(meta?.preMarketPrice) ??
    null;
  const yahooBar = yahooLastBarClose(yahoo.result);
  const stooqLast = stooq?.close ?? null;
  const previousClose =
    asNum(meta?.chartPreviousClose) ??
    asNum(meta?.previousClose) ??
    asNum(meta?.regularMarketPreviousClose) ??
    null;

  const candidates = [yahooMeta, yahooBar, stooqLast].filter((v): v is number => v != null);
  const last = yahooMeta ?? yahooBar ?? stooqLast;

  let reconciled = false;
  let divPct: number | null = null;

  if (stooqLast != null && yahooMeta != null) {
    reconciled = pricesAgree(yahooMeta, stooqLast);
    divPct = divergencePct(yahooMeta, stooqLast);
  } else if (yahooMeta != null && yahooBar != null) {
    reconciled = pricesAgree(yahooMeta, yahooBar);
    divPct = divergencePct(yahooMeta, yahooBar);
  } else if (candidates.length >= 2) {
    reconciled = pricesAgree(candidates[0]!, candidates[1]!);
    divPct = divergencePct(candidates[0]!, candidates[1]!);
  } else if (candidates.length === 1) {
    reconciled = true;
  }

  const change = last != null && previousClose != null ? last - previousClose : null;
  const changePct = change != null && previousClose != null && previousClose !== 0 ? (change / previousClose) * 100 : null;

  return {
    last,
    previousClose,
    change,
    changePct,
    reconciled,
    divergencePct: divPct,
    sources: { yahoo: yahooMeta, yahooBar, stooq: stooqLast },
    series: yahooDailySeries(yahoo.result),
  };
}

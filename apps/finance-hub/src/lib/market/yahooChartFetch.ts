/**
 * Rate-limited Yahoo chart fetch (events=motion) with retry on 429.
 * Shared by dividend payment history and trailing yield helpers.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const MIN_GAP_MS = 450;
const MAX_ATTEMPTS = 4;

let lastFetchAt = 0;

export function yahooChartSymbol(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/\./g, "-");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function throttleYahoo(): Promise<void> {
  const now = Date.now();
  const wait = MIN_GAP_MS - (now - lastFetchAt);
  if (wait > 0) await sleep(wait);
  lastFetchAt = Date.now();
}

async function fetchYahooChartViaCurl(url: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      "curl",
      ["-sS", "-H", "User-Agent: Mozilla/5.0", "-H", "Accept: application/json", url],
      { maxBuffer: 12 * 1024 * 1024 },
    );
    const text = String(stdout ?? "").trim();
    if (!text || text.startsWith("Too Many")) return null;
    return text;
  } catch {
    return null;
  }
}

function parseChartJson(text: string): Record<string, unknown> | null {
  try {
    const json = JSON.parse(text) as Record<string, unknown>;
    const chart = json.chart as Record<string, unknown> | undefined;
    const result = Array.isArray(chart?.result) ? (chart!.result as Record<string, unknown>[])[0] : null;
    return result ?? null;
  } catch {
    return null;
  }
}

export type YahooChartFetchMeta = {
  symbol: string;
  status: number;
  attempts: number;
  rateLimited: boolean;
};

function isValidChartResult(result: Record<string, unknown> | null): result is Record<string, unknown> {
  return result != null && typeof result === "object" && result.meta != null;
}

export type YahooChartQuery = {
  interval?: string;
  range?: string;
  events?: string;
  includePrePost?: boolean;
};

async function fetchYahooChartUrl(
  symbol: string,
  query: YahooChartQuery,
): Promise<{ result: Record<string, unknown>; meta: YahooChartFetchMeta } | null> {
  const sym = yahooChartSymbol(symbol);
  const params = new URLSearchParams();
  params.set("interval", query.interval ?? "1d");
  params.set("range", query.range ?? "5y");
  if (query.events) params.set("events", query.events);
  if (query.includePrePost) params.set("includePrePost", "true");
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?${params.toString()}`;

  await throttleYahoo();
  const curlText = await fetchYahooChartViaCurl(url);
  if (curlText) {
    const curlResult = parseChartJson(curlText);
    if (isValidChartResult(curlResult)) {
      return { result: curlResult, meta: { symbol: sym, status: 200, attempts: 0, rateLimited: false } };
    }
  }

  let rateLimited = false;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    await throttleYahoo();
    const resp = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
    });

    if (resp.status === 429 || resp.status === 503) {
      rateLimited = true;
      const backoff = 800 * attempt;
      await sleep(backoff);
      continue;
    }

    if (!resp.ok) {
      rateLimited = resp.status === 429 || resp.status === 503;
      await sleep(800 * attempt);
      continue;
    }

    const text = await resp.text();
    if (text.startsWith("Too Many")) {
      rateLimited = true;
      await sleep(800 * attempt);
      continue;
    }

    let json: Record<string, unknown>;
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return null;
    }

    const chart = json.chart as Record<string, unknown> | undefined;
    const result = Array.isArray(chart?.result) ? (chart!.result as Record<string, unknown>[])[0] : null;
    if (isValidChartResult(result)) {
      return { result, meta: { symbol: sym, status: resp.status, attempts: attempt, rateLimited } };
    }
  }

  return null;
}

/** Fetch one Yahoo chart JSON payload; returns null when unavailable or rate-limited after retries. */
export async function fetchYahooChartResult(
  symbol: string,
  events: "div" = "div",
): Promise<{ result: Record<string, unknown>; meta: YahooChartFetchMeta } | null> {
  return fetchYahooChartUrl(symbol, { interval: "1d", range: "5y", events });
}

/** Recent daily bars (no dividend events) for mutual-fund NAV / latest close. */
export async function fetchYahooDailyChart(
  symbol: string,
  range: "1d" | "5d" | "1mo" | "10y" = "5d",
): Promise<{ result: Record<string, unknown>; meta: YahooChartFetchMeta } | null> {
  return fetchYahooChartUrl(symbol, { interval: "1d", range });
}

/** Intraday session chart (no dividend events) for index/ETF sparklines. */
export async function fetchYahooIntradayChart(
  symbol: string,
  range: "1d" | "5d" = "1d",
  opts: { includePrePost?: boolean } = {},
): Promise<{ result: Record<string, unknown>; meta: YahooChartFetchMeta } | null> {
  return fetchYahooChartUrl(symbol, {
    interval: "5m",
    range,
    includePrePost: opts.includePrePost,
  });
}

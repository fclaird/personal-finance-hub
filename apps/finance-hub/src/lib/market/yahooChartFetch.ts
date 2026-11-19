/**
 * Rate-limited Yahoo chart fetch (events=motion) with retry on 429.
 * Shared by dividend payment history and trailing yield helpers.
 */

import { parseYahooChartOffThread, yahooChartFromSlim, yieldEventLoop } from "@/lib/eventLoopDiag";
import { curlDeadlineArgs, execFileWithTimeout, fetchWithTimeout } from "@/lib/net/upstream";

const MIN_GAP_MS = 450;
const MAX_ATTEMPTS = 4;

let nextYahooSlot = 0;

export function yahooChartSymbol(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/\./g, "-");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Reserve the next slot before awaiting, so parallel callers do not spawn every curl in one turn. */
async function throttleYahoo(): Promise<void> {
  const now = Date.now();
  const slot = Math.max(now, nextYahooSlot);
  nextYahooSlot = slot + MIN_GAP_MS;
  const wait = slot - now;
  if (wait > 0) await sleep(wait);
}

const CHART_MAX_BYTES = 4 * 1024 * 1024;

async function chartFromBytes(bytes: Uint8Array): Promise<Record<string, unknown> | null> {
  const head = Buffer.from(bytes.subarray(0, Math.min(bytes.byteLength, 16))).toString("utf8");
  if (!head || head.startsWith("Too Many")) return null;
  if (bytes.byteLength >= 64 * 1024) {
    const slim = await parseYahooChartOffThread(bytes);
    await yieldEventLoop();
    return yahooChartFromSlim(slim);
  }
  const text = Buffer.from(bytes).toString("utf8");
  await yieldEventLoop();
  try {
    const json = JSON.parse(text) as Record<string, unknown>;
    const chart = json.chart as Record<string, unknown> | undefined;
    const result = Array.isArray(chart?.result) ? (chart.result[0] as Record<string, unknown>) : null;
    await yieldEventLoop();
    return result;
  } catch {
    return null;
  }
}

async function fetchYahooChartViaCurl(url: string): Promise<Record<string, unknown> | null> {
  try {
    const { stdout } = await execFileWithTimeout(
      "curl",
      ["-sS", ...curlDeadlineArgs(), "-H", "User-Agent: Mozilla/5.0", "-H", "Accept: application/json", url],
      { maxBuffer: CHART_MAX_BYTES, binary: true },
    );
    const bytes = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout);
    return chartFromBytes(bytes);
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

  await yieldEventLoop();
  await throttleYahoo();
  const curlResult = await fetchYahooChartViaCurl(url);
  if (isValidChartResult(curlResult)) {
    return { result: curlResult, meta: { symbol: sym, status: 200, attempts: 0, rateLimited: false } };
  }

  let rateLimited = false;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    await throttleYahoo();
    const resp = await fetchWithTimeout(url, {
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

    const bytes = Buffer.from(await resp.arrayBuffer());
    if (bytes.byteLength > CHART_MAX_BYTES) return null;
    const result = await chartFromBytes(bytes);
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

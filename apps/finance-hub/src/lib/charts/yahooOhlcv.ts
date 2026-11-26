import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { Worker } from "node:worker_threads";

import { sessionDate } from "@/lib/charts/bars";
import type { ChartCandle, ChartQuoteMeta, ExtendedQuote } from "@/lib/charts/types";
import { yahooChartSymbol } from "@/lib/market/yahooChartFetch";

const execFileAsync = promisify(execFile);

export type StorageInterval = "1d" | "5m" | "15m" | "60m";

export type YahooOhlcvPayload = {
  meta: Record<string, unknown>;
  timestamp: Array<number | null>;
  open: Array<number | null>;
  high: Array<number | null>;
  low: Array<number | null>;
  close: Array<number | null>;
  volume: Array<number | null>;
};

type Pending = {
  resolve: (value: YahooOhlcvPayload | null) => void;
  reject: (error: Error) => void;
};

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, Pending>();

export function chartWorkerPath(): string {
  // A bare process.cwd() walk makes the production build trace the whole repo.
  return path.join(/*turbopackIgnore: true*/ process.cwd(), "src/lib/charts/yahooOhlcvWorker.mjs");
}

function rejectAll(error: Error) {
  for (const [id, item] of pending) {
    pending.delete(id);
    item.reject(error);
  }
}

function ensureWorker(): Worker {
  if (worker) return worker;
  const next = new Worker(chartWorkerPath());
  next.on("message", (msg: { id: number; ok: boolean; value?: YahooOhlcvPayload | null; error?: string }) => {
    const item = pending.get(msg.id);
    if (!item) return;
    pending.delete(msg.id);
    if (pending.size === 0) next.unref();
    if (msg.ok) item.resolve(msg.value ?? null);
    else item.reject(new Error(msg.error || "yahoo_ohlcv_parse_failed"));
  });
  next.once("error", (err) => {
    worker = null;
    rejectAll(err instanceof Error ? err : new Error(String(err)));
  });
  next.once("exit", () => {
    worker = null;
    rejectAll(new Error("yahoo_ohlcv_worker_exit"));
  });
  next.unref();
  worker = next;
  return next;
}

export function yieldEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

export function parseYahooOhlcvOffThread(bytes: Uint8Array): Promise<YahooOhlcvPayload | null> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    const active = ensureWorker();
    active.ref();
    active.postMessage({ id, bytes: copy }, [copy.buffer]);
  });
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function quote(price: number | null, change: number | null, changePercent: number | null): ExtendedQuote | null {
  if (price == null || !(price > 0)) return null;
  return { price, change, changePercent };
}

export function exchangeLabel(raw: string | null): string | null {
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (upper.includes("NASDAQ") || upper === "NMS" || upper === "NGM" || upper === "NCM") return "NASDAQ";
  if (upper.includes("NYSE") || upper === "NYQ") return "NYSE";
  return raw;
}

export function metaFromPayload(payload: YahooOhlcvPayload | null): ChartQuoteMeta {
  const meta = payload?.meta ?? {};
  const name = typeof meta.longName === "string" ? meta.longName : typeof meta.shortName === "string" ? meta.shortName : null;
  const exchangeRaw =
    typeof meta.fullExchangeName === "string"
      ? meta.fullExchangeName
      : typeof meta.exchangeName === "string"
        ? meta.exchangeName
        : null;
  return {
    name,
    exchange: exchangeLabel(exchangeRaw),
    currency: typeof meta.currency === "string" ? meta.currency : null,
    marketState: typeof meta.marketState === "string" ? meta.marketState : null,
    previousClose: num(meta.previousClose),
    postMarket: quote(num(meta.postMarketPrice), num(meta.postMarketChange), num(meta.postMarketChangePercent)),
    preMarket: quote(num(meta.preMarketPrice), num(meta.preMarketChange), num(meta.preMarketChangePercent)),
    timezone: typeof meta.exchangeTimezoneName === "string" ? meta.exchangeTimezoneName : typeof meta.timezone === "string" ? meta.timezone : null,
  };
}

export function candlesFromPayload(payload: YahooOhlcvPayload, interval: StorageInterval): ChartCandle[] {
  const byKey = new Map<string, ChartCandle & { ts: number }>();
  const n = payload.timestamp.length;
  for (let i = 0; i < n; i++) {
    const ts = payload.timestamp[i];
    const open = payload.open[i];
    const high = payload.high[i];
    const low = payload.low[i];
    const close = payload.close[i];
    if (typeof ts !== "number" || !Number.isFinite(ts)) continue;
    if (typeof open !== "number" || typeof high !== "number" || typeof low !== "number" || typeof close !== "number") continue;
    if (![open, high, low, close].every((value) => Number.isFinite(value))) continue;
    const volumeRaw = payload.volume[i];
    const volume = typeof volumeRaw === "number" && Number.isFinite(volumeRaw) ? volumeRaw : 0;
    const time = interval === "1d" ? sessionDate(ts) : ts;
    const key = String(time);
    byKey.set(key, { time, open, high, low, close, volume, ts });
  }
  return [...byKey.values()]
    .sort((a, b) => a.ts - b.ts)
    .map(({ time, open, high, low, close, volume }) => ({ time, open, high, low, close, volume }));
}

const RANGE: Record<StorageInterval, { interval: string; range: string; includePrePost: boolean }> = {
  // range=max makes Yahoo downsample equities to monthly bars. 10y stays daily.
  "1d": { interval: "1d", range: "10y", includePrePost: false },
  "5m": { interval: "5m", range: "60d", includePrePost: true },
  "15m": { interval: "15m", range: "60d", includePrePost: true },
  "60m": { interval: "60m", range: "2y", includePrePost: true },
};

let nextSlot = 0;

async function throttle(): Promise<void> {
  const now = Date.now();
  const slot = Math.max(now, nextSlot);
  nextSlot = slot + 450;
  const wait = slot - now;
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
}

export function yahooChartUrl(symbol: string, interval: StorageInterval): string {
  const query = RANGE[interval];
  const params = new URLSearchParams({
    interval: query.interval,
    range: query.range,
    includePrePost: query.includePrePost ? "true" : "false",
  });
  const sym = yahooChartSymbol(symbol);
  return `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?${params.toString()}`;
}

async function fetchBytes(url: string): Promise<Uint8Array | null> {
  try {
    const { stdout } = await execFileAsync(
      "curl",
      ["-sS", "--max-time", "20", "-H", "User-Agent: Mozilla/5.0", "-H", "Accept: application/json", url],
      { maxBuffer: 12 * 1024 * 1024, encoding: "buffer" },
    );
    const bytes = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout);
    if (bytes.byteLength === 0) return null;
    return bytes;
  } catch {
    const resp = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!resp.ok) return null;
    return new Uint8Array(await resp.arrayBuffer());
  }
}

export async function fetchYahooOhlcv(
  symbol: string,
  interval: StorageInterval,
): Promise<{ candles: ChartCandle[]; meta: ChartQuoteMeta }> {
  await yieldEventLoop();
  await throttle();
  const bytes = await fetchBytes(yahooChartUrl(symbol, interval));
  if (!bytes) return { candles: [], meta: metaFromPayload(null) };
  const head = Buffer.from(bytes.subarray(0, 12)).toString("utf8");
  if (head.startsWith("Too Many")) return { candles: [], meta: metaFromPayload(null) };
  const payload = await parseYahooOhlcvOffThread(bytes);
  await yieldEventLoop();
  if (!payload) return { candles: [], meta: metaFromPayload(null) };
  return { candles: candlesFromPayload(payload, interval), meta: metaFromPayload(payload) };
}

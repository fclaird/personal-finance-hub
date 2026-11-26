/**
 * Parse a Yahoo chart body off the request thread. Daily history is large
 * enough to stall /api/health if JSON.parse runs on the main thread.
 */
import { parentPort } from "node:worker_threads";

const META_KEYS = [
  "longName",
  "shortName",
  "exchangeName",
  "fullExchangeName",
  "currency",
  "timezone",
  "exchangeTimezoneName",
  "marketState",
  "previousClose",
  "chartPreviousClose",
  "regularMarketPrice",
  "postMarketPrice",
  "postMarketChange",
  "postMarketChangePercent",
  "preMarketPrice",
  "preMarketChange",
  "preMarketChangePercent",
];

function slim(parsed) {
  const result = Array.isArray(parsed?.chart?.result) ? parsed.chart.result[0] : null;
  if (!result || result.meta == null) return null;
  const quote = result.indicators?.quote?.[0] ?? {};
  const meta = {};
  for (const key of META_KEYS) {
    if (result.meta[key] != null) meta[key] = result.meta[key];
  }
  return {
    meta,
    timestamp: Array.isArray(result.timestamp) ? result.timestamp : [],
    open: Array.isArray(quote.open) ? quote.open : [],
    high: Array.isArray(quote.high) ? quote.high : [],
    low: Array.isArray(quote.low) ? quote.low : [],
    close: Array.isArray(quote.close) ? quote.close : [],
    volume: Array.isArray(quote.volume) ? quote.volume : [],
  };
}

parentPort?.on("message", (msg) => {
  const id = msg?.id;
  try {
    const text = Buffer.from(msg.bytes).toString("utf8");
    if (!text || text.startsWith("Too Many") || text.startsWith("<")) {
      parentPort.postMessage({ id, ok: true, value: null });
      return;
    }
    parentPort.postMessage({ id, ok: true, value: slim(JSON.parse(text)) });
  } catch (err) {
    parentPort.postMessage({
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

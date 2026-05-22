/** Gap only when calls are back-to-back within the same queue. */
const MIN_GAP_MS = 80;
const MAX_RETRIES = 4;

type QueueName = "quotes" | "instruments" | "default";

const chains = new Map<QueueName, Promise<unknown>>();
const lastFetchAt = new Map<QueueName, number>();

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitedError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.includes("429") || msg.toLowerCase().includes("too many requests");
}

export function marketDataQueueForPath(path: string): QueueName {
  if (path.includes("/quotes")) return "quotes";
  if (path.includes("/instruments")) return "instruments";
  return "default";
}

/**
 * Serialize Schwab market-data HTTP calls per queue (quotes don't block behind instruments).
 */
export async function withMarketDataRateLimit<T>(
  queue: QueueName,
  fn: () => Promise<T>,
): Promise<T> {
  const run = async (): Promise<T> => {
    const last = lastFetchAt.get(queue) ?? 0;
    const wait = Math.max(0, MIN_GAP_MS - (Date.now() - last));
    if (wait > 0) await sleep(wait);

    let attempt = 0;
    while (true) {
      lastFetchAt.set(queue, Date.now());
      try {
        return await fn();
      } catch (e) {
        if (!isRateLimitedError(e) || attempt >= MAX_RETRIES) throw e;
        attempt += 1;
        await sleep(Math.min(10_000, 600 * 2 ** attempt));
      }
    }
  };

  const prev = chains.get(queue) ?? Promise.resolve();
  const next = prev.then(run, run);
  chains.set(
    queue,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next as Promise<T>;
}

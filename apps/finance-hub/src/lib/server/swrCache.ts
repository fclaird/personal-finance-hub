export type SwrHit<T> = {
  value: T;
  asOf: string;
  stale: boolean;
  refreshing: boolean;
};

type Entry<T> = {
  value: T;
  asOfMs: number;
  asOf: string;
  load: () => Promise<T>;
};

/**
 * In-memory stale-while-revalidate cache.
 * One in-flight load per key. Fresh hits do not call `load`. Stale hits return
 * the previous value and refresh in the background. Past the stale window, callers wait.
 */
export function createSwrCache<T>(opts: {
  freshMs: () => number;
  staleMs: () => number;
  now?: () => number;
}) {
  const entries = new Map<string, Entry<T>>();
  const inflight = new Map<string, Promise<T>>();
  const now = () => (opts.now ?? Date.now)();

  function write(key: string, value: T, load: () => Promise<T>) {
    const t = now();
    entries.set(key, { value, asOfMs: t, asOf: new Date(t).toISOString(), load });
  }

  function refresh(key: string, load: () => Promise<T>): Promise<T> {
    const existing = inflight.get(key);
    if (existing) return existing;
    const p = load()
      .then((value) => {
        write(key, value, load);
        return value;
      })
      .finally(() => {
        if (inflight.get(key) === p) inflight.delete(key);
      });
    inflight.set(key, p);
    return p;
  }

  async function get(key: string, load: () => Promise<T>, force = false): Promise<SwrHit<T>> {
    const hit = entries.get(key);
    const t = now();
    if (hit && !force) {
      const age = t - hit.asOfMs;
      const fresh = opts.freshMs();
      if (age <= fresh) {
        return { value: hit.value, asOf: hit.asOf, stale: false, refreshing: false };
      }
      if (age <= fresh + opts.staleMs()) {
        void refresh(key, load).catch(() => undefined);
        return { value: hit.value, asOf: hit.asOf, stale: true, refreshing: true };
      }
    }
    const value = await refresh(key, load);
    const entry = entries.get(key);
    return {
      value,
      asOf: entry?.asOf ?? new Date(now()).toISOString(),
      stale: false,
      refreshing: false,
    };
  }

  async function revalidateStale(): Promise<void> {
    const t = now();
    const fresh = opts.freshMs();
    const jobs: Array<Promise<unknown>> = [];
    for (const [key, entry] of entries) {
      if (t - entry.asOfMs > fresh) jobs.push(refresh(key, entry.load).catch(() => undefined));
    }
    await Promise.all(jobs);
  }

  function pending(): Promise<void> {
    return Promise.all([...inflight.values()].map((p) => p.then(() => undefined, () => undefined))).then(
      () => undefined,
    );
  }

  return { get, revalidateStale, pending, size: () => entries.size };
}

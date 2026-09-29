const flights = new Map<string, Promise<unknown>>();

/** One in-flight run per key. A second caller, including a strict-mode remount, joins it. */
export function oncePerPageOpen<T>(key: string, task: () => Promise<T>): Promise<T> {
  const existing = flights.get(key);
  if (existing) return existing as Promise<T>;
  const promise = task().finally(() => {
    if (flights.get(key) === promise) flights.delete(key);
  });
  flights.set(key, promise);
  return promise;
}

export async function fetchSyncFresh(key: string): Promise<boolean> {
  const resp = await fetch(`/api/sync-freshness?key=${encodeURIComponent(key)}`, { cache: "no-store" });
  const json = (await resp.json()) as { ok?: boolean; fresh?: boolean };
  return json.ok === true && json.fresh === true;
}

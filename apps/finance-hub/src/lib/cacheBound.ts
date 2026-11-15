/** Insert key as the newest entry and drop the oldest keys past `max`. */
export function boundCacheSet<K, V>(map: Map<K, V>, key: K, value: V, max: number): void {
  if (max < 1) {
    map.clear();
    return;
  }
  if (map.has(key)) map.delete(key);
  map.set(key, value);
  while (map.size > max) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}
